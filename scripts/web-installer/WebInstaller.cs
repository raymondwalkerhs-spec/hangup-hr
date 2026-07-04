using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class Config
{
    internal const string ProductName = "Hangup Portal";
    // Replaced by scripts/build-web-installer.ps1 at compile time (never commit real values).
    internal const string GitHubRepo = "WEB_INSTALLER_GITHUB_REPO";
    internal const string GitHubToken = "WEB_INSTALLER_GITHUB_TOKEN";
    internal const string PinVersion = "WEB_INSTALLER_PIN_VERSION";
}

internal sealed class WebInstallerForm : Form
{
    readonly Label _status;
    readonly Label _percent;
    readonly ProgressBar _bar;
    readonly Button _cancel;
    WebClient _client;
    string _destPath;

    public WebInstallerForm()
    {
        Text = Config.ProductName + " Setup";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(520, 170);

        var title = new Label
        {
            Text = "Install " + Config.ProductName,
            AutoSize = false,
            Location = new Point(20, 16),
            Size = new Size(480, 24),
            Font = new Font(Font.FontFamily, 11f, FontStyle.Bold)
        };

        _status = new Label
        {
            Text = "Connecting to GitHub...",
            AutoSize = false,
            Location = new Point(20, 48),
            Size = new Size(480, 20)
        };

        _bar = new ProgressBar
        {
            Location = new Point(20, 78),
            Size = new Size(480, 24),
            Minimum = 0,
            Maximum = 100
        };

        _percent = new Label
        {
            Text = "0%",
            AutoSize = false,
            Location = new Point(20, 108),
            Size = new Size(480, 20),
            TextAlign = ContentAlignment.MiddleCenter
        };

        _cancel = new Button
        {
            Text = "Cancel",
            Location = new Point(210, 132),
            Size = new Size(100, 28)
        };
        _cancel.Click += delegate
        {
            try { _client.CancelAsync(); } catch { }
            Close();
        };

        Controls.Add(title);
        Controls.Add(_status);
        Controls.Add(_bar);
        Controls.Add(_percent);
        Controls.Add(_cancel);

        Shown += delegate { BeginInvoke(new Action(StartDownload)); };
    }

    void StartDownload()
    {
        try
        {
            if (Config.GitHubToken.Contains("WEB_INSTALLER"))
                throw new InvalidOperationException("Rebuild with: npm run dist:web-installer (requires .env GITHUB_UPDATES_TOKEN).");

            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            _status.Text = "Finding latest release...";

            string fileName;
            string assetApiUrl;
            ResolveSetupAsset(out fileName, out assetApiUrl);

            var dir = Path.Combine(Path.GetTempPath(), "hangup-hr-web-setup");
            Directory.CreateDirectory(dir);
            _destPath = Path.Combine(dir, fileName);

            _status.Text = "Downloading " + fileName + "...";
            _client = new WebClient();
            _client.Headers.Add("Authorization", "Bearer " + Config.GitHubToken);
            _client.Headers.Add("Accept", "application/octet-stream");
            _client.Headers.Add("User-Agent", "Hangup-Portal-Web-Installer");
            _client.DownloadProgressChanged += OnProgress;
            _client.DownloadFileCompleted += OnCompleted;
            _client.DownloadFileAsync(new Uri(assetApiUrl), _destPath);
        }
        catch (Exception ex)
        {
            Fail(ex.Message);
        }
    }

    void ResolveSetupAsset(out string fileName, out string assetApiUrl)
    {
        var pin = (Config.PinVersion ?? "").Trim().TrimStart('v', 'V');
        Dictionary<string, object> chosenRelease;

        if (!string.IsNullOrEmpty(pin))
        {
            var tag = "v" + pin;
            var api = "https://api.github.com/repos/" + Config.GitHubRepo + "/releases/tags/" + tag;
            chosenRelease = GitHubApiGetObject(api);
        }
        else
        {
            var api = "https://api.github.com/repos/" + Config.GitHubRepo + "/releases?per_page=30";
            var releases = GitHubApiGetList(api);
            if (releases.Count == 0)
                throw new InvalidOperationException("No GitHub releases found for " + Config.GitHubRepo + ".");

            chosenRelease = null;
            Version chosenVer = null;
            foreach (Dictionary<string, object> rel in releases)
            {
                if (rel == null || IsDraft(rel)) continue;
                if (!ReleaseHasSetup(rel)) continue;
                var tag = GetString(rel, "tag_name");
                Version ver;
                if (!Version.TryParse(tag.Trim().TrimStart('v', 'V'), out ver)) ver = new Version(0, 0);
                if (chosenRelease == null || ver > chosenVer)
                {
                    chosenRelease = rel;
                    chosenVer = ver;
                }
            }
            if (chosenRelease == null)
                throw new InvalidOperationException("No release with Setup.exe found.");
        }

        if (chosenRelease == null || IsDraft(chosenRelease))
            throw new InvalidOperationException(string.IsNullOrEmpty(pin)
                ? "No suitable release found."
                : "Release v" + pin + " not found on GitHub.");

        var assetList = GetList(chosenRelease, "assets");
        if (assetList.Count == 0)
            throw new InvalidOperationException("Release has no downloadable assets.");

        foreach (Dictionary<string, object> asset in assetList)
        {
            var name = GetString(asset, "name");
            if (!IsSetupExe(name)) continue;
            var id = GetString(asset, "id");
            if (string.IsNullOrEmpty(id)) continue;
            fileName = name;
            assetApiUrl = "https://api.github.com/repos/" + Config.GitHubRepo + "/releases/assets/" + id;
            return;
        }

        throw new InvalidOperationException("Setup.exe not found on release " + GetString(chosenRelease, "tag_name") + ".");
    }

    static string GitHubApiGet(string apiPath)
    {
        using (var wc = new WebClient())
        {
            wc.Headers.Add("Authorization", "Bearer " + Config.GitHubToken);
            wc.Headers.Add("Accept", "application/vnd.github+json");
            wc.Headers.Add("User-Agent", "Hangup-Portal-Web-Installer");
            try
            {
                return wc.DownloadString(apiPath);
            }
            catch (WebException ex)
            {
                var detail = ex.Message;
                try
                {
                    if (ex.Response != null)
                    {
                        using (var sr = new StreamReader(ex.Response.GetResponseStream()))
                        {
                            var body = sr.ReadToEnd();
                            var err = ParseJson(body) as Dictionary<string, object>;
                            if (err != null && err.ContainsKey("message"))
                                detail = Convert.ToString(err["message"]);
                        }
                    }
                }
                catch { }
                throw new InvalidOperationException("GitHub API error: " + detail);
            }
        }
    }

    static Dictionary<string, object> GitHubApiGetObject(string apiPath)
    {
        var parsed = ParseJson(GitHubApiGet(apiPath));
        var dict = parsed as Dictionary<string, object>;
        if (dict == null)
            throw new InvalidOperationException("Unexpected GitHub API response.");
        return dict;
    }

    static ArrayList GitHubApiGetList(string apiPath)
    {
        return ToArrayList(ParseJson(GitHubApiGet(apiPath)));
    }

    static object ParseJson(string json)
    {
        var ser = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        return ser.DeserializeObject(json);
    }

    static ArrayList ToArrayList(object parsed)
    {
        if (parsed == null) return new ArrayList();
        var list = parsed as ArrayList;
        if (list != null) return list;
        var arr = parsed as object[];
        if (arr != null) return new ArrayList(arr);
        var errDict = parsed as Dictionary<string, object>;
        if (errDict != null && errDict.ContainsKey("message"))
            throw new InvalidOperationException(Convert.ToString(errDict["message"]));
        return new ArrayList();
    }

    static ArrayList GetList(Dictionary<string, object> obj, string key)
    {
        if (obj == null || !obj.ContainsKey(key)) return new ArrayList();
        return ToArrayList(obj[key]);
    }

    static string GetString(Dictionary<string, object> obj, string key)
    {
        if (obj == null || !obj.ContainsKey(key) || obj[key] == null) return "";
        return Convert.ToString(obj[key]);
    }

    static bool IsDraft(Dictionary<string, object> rel)
    {
        return rel.ContainsKey("draft") && rel["draft"] is bool && (bool)rel["draft"];
    }

    static bool ReleaseHasSetup(Dictionary<string, object> rel)
    {
        foreach (Dictionary<string, object> asset in GetList(rel, "assets"))
        {
            if (IsSetupExe(GetString(asset, "name"))) return true;
        }
        return false;
    }

    static bool IsSetupExe(string name)
    {
        if (string.IsNullOrEmpty(name)) return false;
        return name.IndexOf("Setup", StringComparison.OrdinalIgnoreCase) >= 0
               && name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
               && name.IndexOf("uninstall", StringComparison.OrdinalIgnoreCase) < 0;
    }

    void OnProgress(object sender, DownloadProgressChangedEventArgs e)
    {
        _bar.Value = Math.Max(0, Math.Min(100, e.ProgressPercentage));
        _percent.Text = e.ProgressPercentage + "%";
        if (e.TotalBytesToReceive > 0)
        {
            var mb = e.BytesReceived / 1048576.0;
            var total = e.TotalBytesToReceive / 1048576.0;
            _status.Text = string.Format("Downloading... {0:0.0} / {1:0.0} MB", mb, total);
        }
    }

    void OnCompleted(object sender, System.ComponentModel.AsyncCompletedEventArgs e)
    {
        if (e.Cancelled) return;
        if (e.Error != null)
        {
            Fail(e.Error.Message);
            return;
        }

        try
        {
            if (!File.Exists(_destPath) || new FileInfo(_destPath).Length < 1024)
                throw new InvalidOperationException("Downloaded file is missing or too small.");

            _status.Text = "Launching installer...";
            _percent.Text = "100%";
            _bar.Value = 100;
            _cancel.Enabled = false;

            Process.Start(new ProcessStartInfo
            {
                FileName = _destPath,
                UseShellExecute = true
            });
            Thread.Sleep(600);
            Close();
        }
        catch (Exception ex)
        {
            Fail(ex.Message);
        }
    }

    void Fail(string message)
    {
        MessageBox.Show(this, message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
        Close();
    }
}

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new WebInstallerForm());
    }
}
