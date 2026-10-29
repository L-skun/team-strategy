package com.teamstrategy.offline;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.database.Cursor;
import android.provider.OpenableColumns;
import android.util.AtomicFile;
import android.util.Base64;
import android.webkit.*;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.*;
import java.security.MessageDigest;
import java.util.zip.Inflater;

public final class MainActivity extends Activity {
    private static final String ORIGIN="https://appassets.androidplatform.net/";
    private WebView web;
    private SharedPreferences prefs;
    private AtomicFile state;
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingBytes;
    private String pendingName,pendingMime;
    private static final int PICK_WORKBOOK=40,CREATE_FILE=41,IMPORT_FILE=42;
    @Override public void onCreate(Bundle bundle){
        super.onCreate(bundle);prefs=getSharedPreferences("strategy",MODE_PRIVATE);state=new AtomicFile(new File(getFilesDir(),"state.json"));
        web=new WebView(this);setContentView(web);
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(true);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();
                if(!"https".equals(uri.getScheme())||!"appassets.androidplatform.net".equals(uri.getHost()))return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));
                String path=uri.getPath();if(path==null||path.contains(".."))return null;if(path.equals("/"))path="/index.html";
                String mime=path.endsWith(".js")?"application/javascript":path.endsWith(".css")?"text/css":path.endsWith(".html")?"text/html":"application/octet-stream";
                try{return new WebResourceResponse(mime,"UTF-8",getAssets().open(path.substring(1)));}catch(IOException error){return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !request.getUrl().toString().startsWith(ORIGIN);}
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(fileCallback!=null)fileCallback.onReceiveValue(null);fileCallback=callback;
                Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"application/json","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
                startActivityForResult(intent,IMPORT_FILE);return true;
            }
        });
        web.addJavascriptInterface(new Bridge(),"AndroidBridge");web.loadUrl(ORIGIN+"index.html");
        // Keep content within system bars on Android 15+.
        if(android.os.Build.VERSION.SDK_INT>=30)web.setOnApplyWindowInsetsListener((view,insets)->{android.graphics.Insets bars=insets.getInsets(android.view.WindowInsets.Type.systemBars());view.setPadding(bars.left,bars.top,bars.right,bars.bottom);return insets;});
    }
    private byte[] read(InputStream stream)throws Exception{
        if(stream==null)throw new IOException("文件无法打开");
        try(InputStream input=stream;ByteArrayOutputStream output=new ByteArrayOutputStream()){
            byte[] buffer=new byte[8192];int n,total=0;while((n=input.read(buffer))!=-1){total+=n;if(total>25*1024*1024)throw new IOException("文件超过 25 MB");output.write(buffer,0,n);}return output.toByteArray();
        }
    }
    private static String hash(byte[] bytes)throws Exception{StringBuilder result=new StringBuilder();for(byte value:MessageDigest.getInstance("SHA-256").digest(bytes))result.append(String.format("%02x",value&255));return result.toString();}
    private JSONObject error(Exception error){JSONObject result=new JSONObject();try{result.put("error",error.getMessage()==null?"文件操作失败":error.getMessage());}catch(Exception ignored){}return result;}
    private String name(Uri uri){try(Cursor cursor=getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(cursor!=null&&cursor.moveToFirst())return cursor.getString(0);}catch(Exception ignored){}return "手机 Excel";}
    private JSONObject workbook(Uri uri)throws Exception{byte[] bytes=read(getContentResolver().openInputStream(uri));return new JSONObject().put("name",name(uri)).put("base64",Base64.encodeToString(bytes,Base64.NO_WRAP)).put("version",hash(bytes));}
    private void callback(String function,JSONObject result){String text=result.toString();runOnUiThread(()->web.evaluateJavascript("window."+function+"("+JSONObject.quote(text)+")",null));}
    private void createFile(byte[] bytes,String mime,String name){
        runOnUiThread(()->{
            if(pendingBytes!=null){Toast.makeText(this,"请先完成当前保存",Toast.LENGTH_SHORT).show();return;}
            pendingBytes=bytes;pendingName=name;pendingMime=mime;
            Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE,name);
            startActivityForResult(intent,CREATE_FILE);
        });
    }
    public final class Bridge {
        @JavascriptInterface public String readState(){try{return state.getBaseFile().exists()?new String(state.readFully(),"UTF-8"):"";}catch(Exception error){return "";}}
        @JavascriptInterface public String saveState(String json){FileOutputStream output=null;try{new JSONObject(json);output=state.startWrite();output.write(json.getBytes("UTF-8"));state.finishWrite(output);return "{}";}catch(Exception error){if(output!=null)state.failWrite(output);return MainActivity.this.error(error).toString();}}
        @JavascriptInterface public String readWorkbook(){try{String value=prefs.getString("workbook",null);return value==null?"{\"empty\":true}":workbook(Uri.parse(value)).toString();}catch(Exception error){return MainActivity.this.error(error).toString();}}
        @JavascriptInterface public void openWorkbook(){runOnUiThread(()->startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION),PICK_WORKBOOK));}
        @JavascriptInterface public String inflateRaw(String base64){Inflater inflater=new Inflater(true);try{inflater.setInput(Base64.decode(base64,Base64.DEFAULT));ByteArrayOutputStream output=new ByteArrayOutputStream();byte[] buffer=new byte[8192];while(!inflater.finished()){int n=inflater.inflate(buffer);if(n==0)throw new IOException("压缩文件不完整");if(output.size()+n>25*1024*1024)throw new IOException("解压数据过大");output.write(buffer,0,n);}return new JSONObject().put("base64",Base64.encodeToString(output.toByteArray(),Base64.NO_WRAP)).toString();}catch(Exception error){return MainActivity.this.error(error).toString();}finally{inflater.end();}}
        @JavascriptInterface public void exportFile(String base64,String mime,String name){try{createFile(Base64.decode(base64,Base64.DEFAULT),mime,name);}catch(Exception error){callback("onNativeExcelSaved",MainActivity.this.error(error));}}
        @JavascriptInterface public void saveExcel(String base64,String mode,String expectedVersion){
            try{
                byte[] bytes=Base64.decode(base64,Base64.DEFAULT);
                if("new".equals(mode)){createFile(bytes,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","团队赛卡组对局分析.xlsx");return;}
                if(!"overwrite".equals(mode))throw new IOException("未知保存方式");
                String value=prefs.getString("workbook",null);if(value==null)throw new IOException("请先点击“选择手机 Excel”授权文件，或另存为新文件");
                Uri uri=Uri.parse(value);byte[] old=read(getContentResolver().openInputStream(uri));if(!hash(old).equals(expectedVersion))throw new IOException("Excel 已更新，请重新读取或另存为新文件");
                File backupDir=new File(getFilesDir(),"excel-backups");backupDir.mkdirs();File backup=new File(backupDir,System.currentTimeMillis()+".xlsx");try(FileOutputStream output=new FileOutputStream(backup)){output.write(old);}
                try(OutputStream output=getContentResolver().openOutputStream(uri,"wt")){if(output==null)throw new IOException("文件不可写");output.write(bytes);}
                catch(Exception failure){try(OutputStream restore=getContentResolver().openOutputStream(uri,"wt")){if(restore!=null)restore.write(old);}catch(Exception ignored){}throw failure;}
                callback("onNativeExcelSaved",new JSONObject().put("mode","overwrite").put("name",name(uri)).put("version",hash(bytes)).put("backup",backup.getName()));
            }catch(Exception error){callback("onNativeExcelSaved",MainActivity.this.error(error));}
        }
    }
    @Override protected void onActivityResult(int request,int result,Intent intent){
        super.onActivityResult(request,result,intent);Uri uri=intent==null?null:intent.getData();
        if(request==IMPORT_FILE){if(fileCallback!=null){fileCallback.onReceiveValue(result==RESULT_OK&&uri!=null?new Uri[]{uri}:null);fileCallback=null;}return;}
        if(request==CREATE_FILE){try{if(result!=RESULT_OK||uri==null){callback("onNativeExcelSaved",new JSONObject().put("cancelled",true));return;}if(pendingBytes==null)throw new IOException("应用已重启，请重新保存");try(OutputStream output=getContentResolver().openOutputStream(uri,"wt")){if(output==null)throw new IOException("无法写入所选文件");output.write(pendingBytes);}callback("onNativeExcelSaved",new JSONObject().put("mode","new").put("name",name(uri)));}catch(Exception error){callback("onNativeExcelSaved",error(error));}finally{pendingBytes=null;}return;}
        if(request==PICK_WORKBOOK&&result==RESULT_OK&&uri!=null){try{getContentResolver().takePersistableUriPermission(uri,intent.getFlags()&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION));JSONObject data=workbook(uri);prefs.edit().putString("workbook",uri.toString()).apply();callback("onNativeWorkbook",data);}catch(Exception error){callback("onNativeWorkbook",error(error));}}
    }
    @Override public void onBackPressed(){if(web.canGoBack())web.goBack();else super.onBackPressed();}
    @Override protected void onPause(){web.evaluateJavascript("window.dispatchEvent(new Event('pagehide'))",null);super.onPause();}
}
