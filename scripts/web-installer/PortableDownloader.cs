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

// Online downloader for the Hangup Portal PORTABLE build.
// Replaced by scripts/build-portable-downloader.ps1 at compile time (never commit real values).
internal static class Config
{
    internal const string ProductName = "Hangup Portal";
    internal const string GitHubRepo = "WEB_INSTALLER_GITHUB_REPO";
    internal const string GitHubToken = "WEB_INSTALLER_GITHUB_TOKEN";
    internal const string PinVersion = "WEB_INSTALLER_PIN_VERSION";
}

internal sealed class PortableDownloaderForm : Form
{
    readonly Label _status;
    readonly Label _percent;
    readonly ProgressBar _bar;
    readonly Button _cancel;
    readonly Button _run;
    readonly Button _folder;
    WebClient _client;
    string _destPath;

    public PortableDownloaderForm()
    {
        Text = Config.ProductName + " Portable";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(520, 200);

        var title = new Label
        {
            Text = "Download " + Config.ProductName + " (Portable)",
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

        _run = new Button
        {
            Text = "Run Portable",
            Location = new Point(120, 150),
            Size = new Size(140, 30),
            Enabled = false
        };
        _run.Click += delegate
        {
            if (File.Exists(_destPath)) Process.Start(new ProcessStartInfo { FileName = _destPath, UseShellExecute = true });
        };

        _folder = new Button
        {
            Text = "Open Folder",
            Location = new Point(270, 150),
            Size = new Size(130, 30),
            Enabled = false
        };
        _folder.Click += delegate
        {
            if (Directory.Exists(Path.GetDirectoryName(_destPath)))
                Process.Start(new ProcessStartInfo { FileName = Path.GetDirectoryName(_destPath), UseShellExecute = true });
        };

        _cancel = new Button
        {
            Text = "Cancel",
            Location = new Point(410, 150),
            Size = new Size(80, 30)
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
        Controls.Add(_run);
        Controls.Add(_folder);
        Controls.Add(_cancel);

        Shown += delegate { BeginInvoke(new Action(StartDownload)); };
    }

    void StartDownload()
    {
        try
        {
            if (Config.GitHubToken.Contains("WEB_INSTALLER"))
                throw new InvalidOperationException("Rebuild with: npm run dist:portable-downloader (requires .env GITHUB_UPDATES_TOKEN).");

            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            _status.Text = "Finding latest Portable release...";

            string fileName;
            string assetApiUrl;
            ResolvePortableAsset(out fileName, out assetApiUrl);

            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads", "hangup-portal-portable");
            Directory.CreateDirectory(dir);
            _destPath = Path.Combine(dir, fileName);

            _status.Text = "Downloading " + fileName + "...";
            _client = new WebClient();
            _client.Headers.Add("Authorization", "Bearer " + Config.GitHubToken);
            _client.Headers.Add("Accept", "application/octet-stream");
            _client.Headers.Add("User-Agent", "Hangup-Portal-Portable-Downloader");
            _client.DownloadProgressChanged += OnProgress;
            _client.DownloadFileCompleted += OnCompleted;
            _client.DownloadFileAsync(new Uri(assetApiUrl), _destPath);
        }
        catch (Exception ex)
        {
            Fail(ex.Message);
        }
    }

    void ResolvePortableAsset(out string fileName, out string assetApiUrl)
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
            var api = "https://api.github.com/repos/" + Config.GitHubRepo + "/releases/latest";
            chosenRelease = GitHubApiGetObject(api);
            if (!ReleaseHasPortable(chosenRelease))
                throw new InvalidOperationException("Latest GitHub release has no Portable.exe — publish Portable for " + GetString(chosenRelease, "tag_name") + ".");
        }

        if (chosenRelease == null || IsDraft(chosenRelease))
            throw new InvalidOperationException(string.IsNullOrEmpty(pin)
                ? "No suitable release found."
                : "Release v" + pin + " not found on GitHub.");

        var assetList = GetList(chosenRelease, "assets");
        if (assetList.Count == 0)
            throw new InvalidOperationException("Release has no downloadable assets.");

        var releaseVer = ParseReleaseVersion(GetString(chosenRelease, "tag_name"));
        string pickedId;
        fileName = PickBestPortableAsset(assetList, releaseVer, out pickedId);
        if (string.IsNullOrEmpty(fileName))
            throw new InvalidOperationException("Portable.exe not found on release " + GetString(chosenRelease, "tag_name") + ".");
        assetApiUrl = "https://api.github.com/repos/" + Config.GitHubRepo + "/releases/assets/" + pickedId;
    }

    static string PickBestPortableAsset(ArrayList assetList, Version releaseVer, out string assetId)
    {
        assetId = "";
        string bestName = null;
        int bestScore = -1;
        foreach (Dictionary<string, object> asset in assetList)
        {
            var name = GetString(asset, "name");
            if (!IsPortableExe(name)) continue;
            var id = GetString(asset, "id");
            if (string.IsNullOrEmpty(id)) continue;
            var score = 10;
            if (name.IndexOf("Portal-Portable", StringComparison.OrdinalIgnoreCase) >= 0) score = 100;
            else if (name.IndexOf("Portable", StringComparison.OrdinalIgnoreCase) >= 0) score = 80;

            var fileVer = ParseVersionFromSetupName(name);
            if (releaseVer != null && fileVer != null && fileVer == releaseVer) score += 10000;
            else if (fileVer != null) score += fileVer.Major * 1000 + fileVer.Minor * 100 + fileVer.Build;

            if (score > bestScore)
            {
                bestScore = score;
                bestName = name;
                assetId = id;
            }
        }
        return bestName;
    }

    static Version ParseVersionFromSetupName(string name)
    {
        if (string.IsNullOrEmpty(name)) return null;
        var match = System.Text.RegularExpressions.Regex.Match(name, @"(\d+\.\d+(?:\.\d+)?(?:\.\d+)?)");
        if (!match.Success) return null;
        Version ver;
        return Version.TryParse(match.Groups[1].Value, out ver) ? ver : null;
    }

    static int SetupAssetScore(string name, Version releaseVer)
    {
        var score = 10;
        if (name.IndexOf("Portal-Portable", StringComparison.OrdinalIgnoreCase) >= 0) score = 100;
        else if (name.IndexOf("Portable", StringComparison.OrdinalIgnoreCase) >= 0) score = 80;

        var fileVer = ParseVersionFromSetupName(name);
        if (releaseVer != null && fileVer != null && fileVer == releaseVer) score += 10000;
        else if (fileVer != null) score += fileVer.Major * 1000 + fileVer.Minor * 100 + fileVer.Build;
        return score;
    }

    static string GitHubApiGet(string apiPath)
    {
        using (var wc = new WebClient())
        {
            wc.Headers.Add("Authorization", "Bearer " + Config.GitHubToken);
            wc.Headers.Add("Accept", "application/vnd.github+json");
            wc.Headers.Add("User-Agent", "Hangup-Portal-Portable-Downloader");
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

    static Version ParseReleaseVersion(string tag)
    {
        var core = (tag ?? "").Trim().TrimStart('v', 'V');
        var dash = core.IndexOf('-');
        if (dash > 0) core = core.Substring(0, dash);
        Version ver;
        if (Version.TryParse(core, out ver)) return ver;
        return new Version(0, 0);
    }

    static bool IsDraft(Dictionary<string, object> rel)
    {
        return rel.ContainsKey("draft") && rel["draft"] is bool && (bool)rel["draft"];
    }

    static bool ReleaseHasPortable(Dictionary<string, object> rel)
    {
        foreach (Dictionary<string, object> asset in GetList(rel, "assets"))
        {
            if (IsPortableExe(GetString(asset, "name"))) return true;
        }
        return false;
    }

    static bool IsPortableExe(string name)
    {
        if (string.IsNullOrEmpty(name)) return false;
        if (name.IndexOf("Web-Setup", StringComparison.OrdinalIgnoreCase) >= 0) return false;
        if (name.IndexOf("uninstall", StringComparison.OrdinalIgnoreCase) >= 0) return false;
        if (name.IndexOf("Setup", StringComparison.OrdinalIgnoreCase) >= 0) return false;
        return name.IndexOf("Portable", StringComparison.OrdinalIgnoreCase) >= 0
               && name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase);
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
            if (!File.Exists(_destPath) || new FileInfo(_destPath).Length < 1024 * 1024)
                throw new InvalidOperationException("Downloaded Portable is missing or too small — expected the full Portable.exe.");

            _status.Text = "Ready — Portable downloaded.";
            _percent.Text = "100%";
            _bar.Value = 100;
            _cancel.Enabled = false;
            _run.Enabled = true;
            _folder.Enabled = true;
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
        Application.Run(new PortableDownloaderForm());
    }
}
