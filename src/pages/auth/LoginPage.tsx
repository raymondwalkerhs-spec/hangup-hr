import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { api, setSessionId } from "@/api/client";
import { canAccessPage, firstAllowedPage, type StatusUser } from "@/lib/nav-access";
import { useAuth } from "@/app/AuthProvider";
import { Button } from "@/ui/Button";
import {
  applyDesktopUpdate,
  canApplyDesktopUpdate,
  fetchGitHubUpdateInfo,
  fetchVersionInfo,
  githubReleasePageUrl,
  type GitHubUpdateInfo,
  getHrDesktop,
  updateActionHint,
} from "@/lib/desktopUpdate";
import styles from "./LoginPage.module.css";

function pageFromPath(path: string): string {
  return path.replace(/^\//, "").split("/")[0] || "dashboard";
}

const NATIONALITIES = ["Egyptian", "Sudanese", "Ethiopian", "Eritrean", "South Sudanese"];

function isEgyptian(n: string) {
  const x = n.trim().toLowerCase();
  return x === "egyptian" || x === "egypt" || x === "egyptain";
}

function formatRegPin(raw: string) {
  const clean = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8);
  if (clean.length <= 4) return clean;
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}

function pinCells(pin: string) {
  const compact = pin.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const slots: string[] = ["", "", "", "", "", "", "", ""];
  for (let i = 0; i < Math.min(compact.length, 8); i += 1) {
    slots[i] = compact[i];
  }
  return slots;
}

function OtpCell({ char, active }: { char: string; active: boolean }) {
  const filled = char.length > 0;
  return (
    <div
      className={`${styles.otpNode} ${filled ? styles.otpHasValue : ""} ${active ? styles.otpActive : ""}`}
    >
      <svg className={styles.otpSvg} viewBox="0 0 44 52" aria-hidden>
        <rect
          className={styles.otpTrace}
          x="2"
          y="2"
          width="40"
          height="48"
          rx="8"
          fill="none"
          strokeWidth="2"
          pathLength="100"
        />
      </svg>
      <span className={styles.otpChar}>{char}</span>
    </div>
  );
}

function RegistrationPinInput({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cells = pinCells(value);
  const compactLen = value.replace(/[^A-Za-z0-9]/g, "").length;
  const [focused, setFocused] = useState(false);
  const activeIndex = focused ? Math.min(compactLen, 7) : -1;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className={styles.otpWrap}
      onClick={() => inputRef.current?.focus()}
      role="group"
      aria-label="Registration code"
    >
      <input
        ref={inputRef}
        className={styles.otpOverlay}
        value={value}
        onChange={(e) => onChange(formatRegPin(e.target.value))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        inputMode="text"
        aria-label="Registration code"
      />
      <div className={styles.otpRow} aria-hidden>
        {cells.slice(0, 4).map((ch, i) => (
          <OtpCell key={`l-${i}-${ch}`} char={ch} active={activeIndex === i} />
        ))}
        <span className={styles.otpDash}>-</span>
        {cells.slice(4, 8).map((ch, i) => (
          <OtpCell key={`r-${i}-${ch}`} char={ch} active={activeIndex === i + 4} />
        ))}
      </div>
    </div>
  );
}

type HelixSpec = {
  cx: number;
  radius: number;
  twist: number;
  phase: number;
};

function DnaLoops() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let running = true;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let t0 = performance.now();

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = parent.clientWidth;
      height = parent.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const wrap01 = (v: number) => {
      const r = v % 1;
      return r < 0 ? r + 1 : r;
    };

    const drawHelix = (
      spec: HelixSpec,
      spin: number,
      rise: number,
      pairCount: number
    ) => {
      const { cx, radius, twist, phase } = spec;
      const midY = height * 0.5;
      const span = height * 1.18;
      type Node = {
        y: number;
        x1: number;
        x2: number;
        z1: number;
        z2: number;
        depth: number;
      };
      const nodes: Node[] = [];

      for (let i = 0; i < pairCount; i += 1) {
        const along = wrap01(i / pairCount + rise);
        const y = midY + span * 0.5 - along * span;
        const theta = along * twist * Math.PI * 2 + spin + phase;
        const z1 = Math.cos(theta);
        const z2 = Math.cos(theta + Math.PI);
        nodes.push({
          y,
          x1: cx + Math.sin(theta) * radius,
          x2: cx + Math.sin(theta + Math.PI) * radius,
          z1,
          z2,
          depth: (z1 + z2) * 0.5,
        });
      }

      nodes.sort((a, b) => a.depth - b.depth || a.y - b.y);

      for (const n of nodes) {
        const fadeEdge = Math.max(0, 1 - Math.abs(n.y - midY) / (span * 0.52));
        const depthA = 0.38 + (n.z1 + 1) * 0.31;
        const depthB = 0.38 + (n.z2 + 1) * 0.31;
        const alpha = fadeEdge * 0.92;
        if (alpha < 0.04) continue;

        ctx.strokeStyle = `rgba(255,255,255,${0.12 + alpha * 0.22})`;
        ctx.lineWidth = 1.15;
        ctx.beginPath();
        ctx.moveTo(n.x1, n.y);
        ctx.lineTo(n.x2, n.y);
        ctx.stroke();

        const rA = 2.1 + depthA * 2.4;
        const rB = 2.1 + depthB * 2.4;
        ctx.fillStyle = `rgba(255,255,255,${alpha * depthA})`;
        ctx.beginPath();
        ctx.arc(n.x1, n.y, rA, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255,210,190,${alpha * depthB})`;
        ctx.beginPath();
        ctx.arc(n.x2, n.y, rB, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const frame = (now: number) => {
      if (!running) return;
      const elapsed = (now - t0) / 1000;
      ctx.clearRect(0, 0, width, height);

      const spin = reduceMotion ? 0.6 : elapsed * 0.85;
      const rise = reduceMotion ? 0 : elapsed * 0.045;
      const pairCount = Math.max(22, Math.round(height / 22));
      const radius = Math.min(46, width * 0.07);
      const right = width * 0.78;
      const gap = Math.min(118, width * 0.18);

      drawHelix(
        { cx: right - gap * 0.5, radius, twist: 3.15, phase: 0 },
        spin,
        rise,
        pairCount
      );
      drawHelix(
        { cx: right + gap * 0.5, radius: radius * 0.92, twist: 3.15, phase: Math.PI * 0.55 },
        spin,
        rise * 0.92,
        pairCount
      );

      raf = requestAnimationFrame(frame);
    };

    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    raf = requestAnimationFrame(frame);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div className={styles.dnaScene} aria-hidden>
      <canvas ref={canvasRef} className={styles.dnaCanvas} />
    </div>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshStatus } = useAuth();
  const [view, setView] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [regStep, setRegStep] = useState(1);
  const [pin, setPin] = useState("");
  const [registrationToken, setRegistrationToken] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [loginBlocked, setLoginBlocked] = useState("");
  const [updateBanner, setUpdateBanner] = useState<{ title: string; message: string; urgent?: boolean } | null>(null);
  const [githubUpdate, setGithubUpdate] = useState<GitHubUpdateInfo | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [regForm, setRegForm] = useState({
    americanName: "",
    fullName: "",
    email: "",
    nationality: "",
    nationalityOther: "",
    nationalId: "",
    passportNumber: "",
    phone: "",
    unit: "HS-3",
    password: "",
    passwordConfirm: "",
  });

  const nationalityValue = useMemo(() => {
    if (regForm.nationality === "__other__") return regForm.nationalityOther.trim();
    return regForm.nationality.trim();
  }, [regForm.nationality, regForm.nationalityOther]);

  const egyptian = isEgyptian(nationalityValue);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchVersionInfo();
        if (data.appVersion) setAppVersion(data.appVersion);
        if (data.versionCheck?.status === "blocked") {
          setLoginBlocked(data.versionCheck.message || "This app version is no longer supported.");
        }
        if (data.installHealth && data.installHealth.ok === false) {
          setUpdateBanner({
            title: "Reinstall required",
            message: data.installHealth.message || "The installation needs repair.",
            urgent: true,
          });
        }
        let gh = data.githubUpdate || null;
        if (getHrDesktop()?.checkGitHubUpdate) {
          try {
            const desktopGh = await fetchGitHubUpdateInfo();
            if (desktopGh?.enabled !== false) gh = desktopGh;
          } catch {
            /* use server result */
          }
        }
        setGithubUpdate(gh);
        const blocked = data.versionCheck?.status === "blocked";
        if (blocked) {
          const latest = gh?.latest || data.versionCheck?.currentVersion;
          const hasPackage = Boolean(gh?.assetUrl || gh?.assetId || gh?.assetName);
          setUpdateBanner({
            title: "Update required",
            message: hasPackage
              ? `Version ${latest} is ready (you have ${gh?.current || data.appVersion}). ${updateActionHint(gh)}`
              : `${data.versionCheck?.message || "This app version is no longer supported."} Use Update now, or download the latest installer.`,
            urgent: true,
          });
          return;
        }
        if (gh?.enabled && gh.updateAvailable) {
          const hasPackage = Boolean(gh.assetUrl || gh.assetId || gh.assetName);
          setUpdateBanner({
            title: "Update available",
            message: hasPackage
              ? `Version ${gh.latest} is ready (you have ${gh.current || data.appVersion}). ${updateActionHint(gh)}`
              : `Version ${gh.latest} is on GitHub (you have ${gh.current || data.appVersion}). Install the latest build when convenient.`,
            urgent: false,
          });
        }
      } catch {
        /* non-fatal */
      }
    })();
  }, []);

  const canLoginUpdate = canApplyDesktopUpdate(githubUpdate, { requireAvailable: !loginBlocked });

  const handleLoginUpdate = async () => {
    setUpdateBusy(true);
    try {
      const result = await applyDesktopUpdate();
      if (result?.needsQuit) return;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUpdateBusy(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api<{
        sessionId: string;
        needsSetup?: boolean;
        needsMfaEnroll?: boolean;
        needsGoogleLink?: boolean;
      }>("/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setSessionId(data.sessionId);
      getHrDesktop()?.setSession?.(data.sessionId);
      if (data.needsMfaEnroll) {
        navigate("/setup-2fa", { replace: true });
        return;
      }
      if (data.needsGoogleLink || data.needsSetup) {
        navigate("/link-google", { replace: true });
        return;
      }
      const status = await refreshStatus();
      const user = (status?.user as StatusUser) || undefined;
      const from = (location.state as { from?: string } | null)?.from;
      const fromPage = from ? pageFromPath(from) : "";
      const target =
        from && from !== "/login" && canAccessPage(user, fromPage)
          ? from
          : `/${firstAllowedPage(user)}`;
      navigate(target, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError("");
    setLoading(true);
    try {
      const data = await api<{ url: string }>("/auth/google/cold-start", {
        method: "POST",
        body: "{}",
      });
      const desktop = getHrDesktop();
      if (desktop?.openExternal) {
        await desktop.openExternal(data.url);
      } else {
        window.open(data.url, "_blank", "noopener,noreferrer");
      }
      navigate("/oauth-pending", { replace: true, state: { mode: "cold" } });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const verifyPin = async () => {
    const code = pin.trim();
    const compact = code.replace(/[^A-Za-z0-9]/g, "");
    if (!/^\d{4}$/.test(compact) && compact.length < 8) {
      setError("Enter today's registration code from your supervisor.");
      return;
    }
    setError("");
    try {
      const data = await api<{ registrationToken?: string }>("/registration/verify-pin", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      if (!data.registrationToken) throw new Error("Invalid registration code");
      setRegistrationToken(data.registrationToken);
      setRegStep(2);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const submitRegistration = async () => {
    setError("");
    setLoading(true);
    try {
      const americanName = regForm.americanName.trim().replace(/\s+/g, " ");
      const americanWords = americanName.split(" ").filter(Boolean);
      if (americanWords.length !== 2) throw new Error("American name must be exactly 2 words (First and Last name).");
      const legalWords = regForm.fullName.trim().split(/\s+/).filter(Boolean);
      if (legalWords.length < 3) throw new Error("Legal name must contain at least 3 words.");
      if (!regForm.email.includes("@")) throw new Error("A valid email is required.");
      if (regForm.password.length < 8) throw new Error("Password must be at least 8 characters.");
      if (regForm.password !== regForm.passwordConfirm) throw new Error("Password confirmation does not match.");

      const data = await api<{ message?: string }>("/registration/apply", {
        method: "POST",
        body: JSON.stringify({
          registrationToken,
          fullName: regForm.fullName.trim(),
          americanName,
          email: regForm.email.trim(),
          nationality: nationalityValue,
          nationalId: regForm.nationalId.trim(),
          passportNumber: regForm.passportNumber.trim(),
          phone: regForm.phone.trim(),
          unit: regForm.unit,
          password: regForm.password,
          passwordConfirm: regForm.passwordConfirm,
        }),
      });
      setSuccessMsg(data.message || "Registration submitted. HR will review and activate your account.");
      setRegStep(3);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <motion.div
        className={styles.hero}
        initial={{ x: -40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <DnaLoops />
        <div className={styles.heroContent}>
          <img src="/img/hr-team.png" alt="Hangup" className={styles.heroLogo} />
          <h1>Hangup Portal</h1>
          <p>One portal for agents, QA, and leadership.</p>
        </div>
      </motion.div>

      <motion.div
        className={styles.card}
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        {view === "login" ? (
          <>
            {updateBanner && (
              <div className={`${styles.updateBanner} ${updateBanner.urgent ? styles.updateUrgent : ""}`}>
                <strong>{updateBanner.title}</strong>
                <p>{updateBanner.message}</p>
                {canLoginUpdate && (
                  <Button size="sm" onClick={handleLoginUpdate} disabled={updateBusy}>
                    {updateBusy ? "Downloading…" : "Update now"}
                  </Button>
                )}
                {!canLoginUpdate && (
                  <a
                    href={githubReleasePageUrl(githubUpdate)}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.downloadLink}
                  >
                    Download latest installer
                  </a>
                )}
              </div>
            )}
            <h2>Sign in</h2>
            <form onSubmit={handleLogin}>
              <label className={styles.field}>
                <span>Username</span>
                <input value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" />
              </label>
              <label className={styles.field}>
                <span>Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </label>
              {error && <p className={styles.error}>{error}</p>}
              {loginBlocked && <p className={styles.error}>{loginBlocked}</p>}
              <Button type="submit" className={`${styles.submit} ${styles.btnDna}`} disabled={loading || Boolean(loginBlocked)}>
                <span className={styles.btnDnaText}>{loading ? "Signing in…" : "Sign in"}</span>
              </Button>
            </form>
            <Button
              type="button"
              variant="secondary"
              className={styles.submit}
              disabled={loading || Boolean(loginBlocked)}
              onClick={handleGoogleLogin}
            >
              Sign in with Google
            </Button>
            <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.35rem" }}>
              Google works only after you link it once (password login → Link Google). No Authenticator code at login.
            </p>
            <p className="muted">
              New agent?{" "}
              <button type="button" className={styles.link} onClick={() => { setView("register"); setError(""); setRegStep(1); }}>
                Create registration →
              </button>
            </p>
            {appVersion && <p className={styles.versionLine}>App version {appVersion}</p>}
          </>
        ) : (
          <>
            <div className={styles.stepper}>
              {[1, 2, 3].map((s) => (
                <div key={s} className={`${styles.step} ${regStep >= s ? styles.stepActive : ""}`}>
                  {s}
                </div>
              ))}
            </div>
            {regStep === 1 && (
              <>
                <h2>Enter registration code</h2>
                <p className="muted" style={{ marginBottom: "0.75rem" }}>Ask OP, HR, or Quality for today&apos;s code.</p>
                <RegistrationPinInput
                  value={pin}
                  onChange={(next) => {
                    setPin(next);
                    setError("");
                  }}
                  onSubmit={verifyPin}
                />
                {error && <p className={styles.error}>{error}</p>}
                <Button onClick={verifyPin}>Continue</Button>
              </>
            )}
            {regStep === 2 && (
              <>
                <h2>Your details</h2>
                <label className={styles.field}>
                  <span>American name</span>
                  <input value={regForm.americanName} onChange={(e) => setRegForm({ ...regForm, americanName: e.target.value })} placeholder="First and Last name only (2 words)" />
                </label>
                <label className={styles.field}>
                  <span>Legal name</span>
                  <input value={regForm.fullName} onChange={(e) => setRegForm({ ...regForm, fullName: e.target.value })} placeholder="Name on your ID (at least 3 words)" />
                </label>
                <label className={styles.field}>
                  <span>Email</span>
                  <input type="email" value={regForm.email} onChange={(e) => setRegForm({ ...regForm, email: e.target.value })} placeholder="you@example.com" />
                </label>
                <label className={styles.field}>
                  <span>Nationality</span>
                  <select value={regForm.nationality} onChange={(e) => setRegForm({ ...regForm, nationality: e.target.value })}>
                    <option value="">— Select —</option>
                    {NATIONALITIES.map((n) => <option key={n} value={n}>{n}</option>)}
                    <option value="__other__">Other…</option>
                  </select>
                  {regForm.nationality === "__other__" && (
                    <input value={regForm.nationalityOther} onChange={(e) => setRegForm({ ...regForm, nationalityOther: e.target.value })} placeholder="Enter nationality" style={{ marginTop: "0.35rem" }} />
                  )}
                </label>
                {(!nationalityValue || egyptian) && (
                  <label className={styles.field}>
                    <span>National ID (14 digits)</span>
                    <input value={regForm.nationalId} onChange={(e) => setRegForm({ ...regForm, nationalId: e.target.value.replace(/\D/g, "").slice(0, 14) })} inputMode="numeric" placeholder="For Egyptians" />
                  </label>
                )}
                {nationalityValue && !egyptian && (
                  <label className={styles.field}>
                    <span>Passport number</span>
                    <input value={regForm.passportNumber} onChange={(e) => setRegForm({ ...regForm, passportNumber: e.target.value })} placeholder="For non-Egyptians" />
                  </label>
                )}
                <label className={styles.field}>
                  <span>Phone</span>
                  <input value={regForm.phone} onChange={(e) => setRegForm({ ...regForm, phone: e.target.value })} />
                </label>
                <label className={styles.field}>
                  <span>Unit</span>
                  <select value={regForm.unit} onChange={(e) => setRegForm({ ...regForm, unit: e.target.value })}>
                    <option value="HS-3">HS-3</option>
                    <option value="HS-1">HS-1</option>
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Choose password</span>
                  <input type="password" value={regForm.password} onChange={(e) => setRegForm({ ...regForm, password: e.target.value })} autoComplete="new-password" minLength={8} placeholder="At least 8 characters" />
                </label>
                <label className={styles.field}>
                  <span>Confirm password</span>
                  <input type="password" value={regForm.passwordConfirm} onChange={(e) => setRegForm({ ...regForm, passwordConfirm: e.target.value })} autoComplete="new-password" minLength={8} />
                </label>
                <p className="muted" style={{ fontSize: "0.85rem" }}>
                  Team is assigned by Admin/HR after approval.
                </p>
                {error && <p className={styles.error}>{error}</p>}
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <Button variant="secondary" onClick={() => setRegStep(1)}>← Back</Button>
                  <Button onClick={submitRegistration} disabled={loading} style={{ flex: 1 }}>{loading ? "Submitting…" : "Submit registration"}</Button>
                </div>
              </>
            )}
            {regStep === 3 && (
              <>
                <h2>Request submitted</h2>
                <p className="muted">{successMsg}</p>
                <Button onClick={() => { setView("login"); setRegStep(1); setError(""); }}>Back to sign in</Button>
              </>
            )}
            <button type="button" className={styles.link} onClick={() => { setView("login"); setError(""); }}>
              ← Back to sign in
            </button>
          </>
        )}
      </motion.div>
    </div>
  );
}
