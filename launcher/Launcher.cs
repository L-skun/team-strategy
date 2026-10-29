using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using System.Collections.Generic;

static class Launcher {
    static string project = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "team-strategy");
    static JavaScriptSerializer json = new JavaScriptSerializer();
    static bool Ready(int port) {
        try {
            using(var socket = new System.Net.Sockets.TcpClient()) {
                var pending=socket.BeginConnect("127.0.0.1",port,null,null);
                if(!pending.AsyncWaitHandle.WaitOne(40)) return false;
                socket.EndConnect(pending);
            }
            var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/health");
            request.Timeout = 400; request.Proxy = null;
            using(var response = request.GetResponse())
            using(var reader = new StreamReader(response.GetResponseStream())) {
                var data = json.Deserialize<Dictionary<string,object>>(reader.ReadToEnd());
                return (string)data["app"] == "team-strategy" && data.ContainsKey("protocolVersion") && Convert.ToInt32(data["protocolVersion"]) == 2 && String.Equals((string)data["directory"], project, StringComparison.OrdinalIgnoreCase);
            }
        } catch { return false; }
    }
    [STAThread]
    static int Main(string[] args) {
        bool check = Array.IndexOf(args, "--check") >= 0;
        try {
            if(!File.Exists(Path.Combine(project,"serve.cjs"))) throw new Exception("找不到 team-strategy 文件夹，请将 EXE 与项目文件夹放在一起。");
            string node = Path.Combine(project,"runtime","node.exe");
            if(!File.Exists(node)) throw new Exception("缺少运行组件 team-strategy/runtime/node.exe，请恢复该文件后重试。");
            string mutexId = Convert.ToBase64String(Encoding.UTF8.GetBytes(project)).Replace('\\','_').Replace('/','_');
            using(var mutex = new Mutex(false,"Local\\TeamStrategy-"+mutexId)) {
                if(!mutex.WaitOne(20000)) throw new Exception("另一个启动程序正在运行，请稍后重试。");
                try {
                    for(int port=4173; port<=4193; port++) {
                        if(Ready(port)) { Open(port,check); return 0; }
                    }
                    for(int port=4173; port<=4193; port++) {
                        var info = new ProcessStartInfo(node,"\""+Path.Combine(project,"serve.cjs")+"\" "+port);
                        info.WorkingDirectory=project; info.UseShellExecute=false; info.CreateNoWindow=true; info.WindowStyle=ProcessWindowStyle.Hidden;
                        using(var process = Process.Start(info)) {
                            for(int attempt=0; attempt<40; attempt++) {
                                if(process.HasExited) break;
                                if(Ready(port)) { Open(port,check); return 0; }
                                Thread.Sleep(100);
                            }
                            if(!process.HasExited) process.Kill();
                        }
                    }
                    throw new Exception("本地服务启动失败，请检查项目文件夹是否完整、端口 4173–4193 是否可用。");
                } finally { mutex.ReleaseMutex(); }
            }
        } catch(Exception error) {
            if(!check) MessageBox.Show(error.Message,"团队赛策略台",MessageBoxButtons.OK,MessageBoxIcon.Error);
            return 1;
        }
    }
    static void Open(int port,bool check) {
        if(!check) Process.Start(new ProcessStartInfo("http://127.0.0.1:"+port) { UseShellExecute=true });
    }
}
