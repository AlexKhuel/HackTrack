import { useEffect, useRef, useState } from "react"
import { Capacitor } from "@capacitor/core"
import { SocialLogin } from "@capgo/capacitor-social-login"

const GOOGLE_IDENTITY_SCRIPT_ID = "google-identity-services-script"
const GOOGLE_IDENTITY_SCRIPT_SRC = "https://accounts.google.com/gsi/client"
const GOOGLE_SCOPES = ["profile", "email", "openid"]

function loadGoogleIdentityScript() {
  const existing = document.getElementById(GOOGLE_IDENTITY_SCRIPT_ID)
  if (existing) {
    if (window.google?.accounts?.id) {
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true })
      existing.addEventListener("error", () => reject(new Error("Failed to load Google Sign-In SDK.")), {
        once: true,
      })
    })
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.id = GOOGLE_IDENTITY_SCRIPT_ID
    script.src = GOOGLE_IDENTITY_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error("Failed to load Google Sign-In SDK."))
    document.head.appendChild(script)
  })
}

export default function GoogleSignInPage({
  onCredential,
  onContinueAsGuest,
  errorText = "",
  isBusy = false,
}) {
  const buttonRef = useRef(null)
  const [localError, setLocalError] = useState("")
  const [isNativeSigningIn, setIsNativeSigningIn] = useState(false)
  const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "").toString().trim()
  const iosClientId = (import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID ?? "")
    .toString()
    .trim()
  const nativeClientId = iosClientId || clientId
  const serverClientId = (import.meta.env.VITE_GOOGLE_SERVER_CLIENT_ID ?? clientId)
    .toString()
    .trim()
  const isNativeIos = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios"

  useEffect(() => {
    if (isNativeIos) return

    let cancelled = false

    const renderGoogleButton = async () => {
      if (!clientId) {
        setLocalError("Missing VITE_GOOGLE_CLIENT_ID in web client environment.")
        return
      }

      try {
        await loadGoogleIdentityScript()
        if (cancelled || !buttonRef.current) return

        if (!window.google?.accounts?.id) {
          setLocalError("Google Sign-In SDK did not initialize correctly.")
          return
        }

        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            const credential = (response?.credential ?? "").toString().trim()
            if (!credential) {
              setLocalError("Google did not return a credential.")
              return
            }
            onCredential?.(credential)
          },
        })

        buttonRef.current.innerHTML = ""
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: "outline",
          size: "large",
          type: "standard",
          shape: "pill",
          text: "signin_with",
          width: 320,
        })
      } catch (err) {
        if (!cancelled) {
          setLocalError(err?.message || "Could not initialize Google Sign-In.")
        }
      }
    }

    void renderGoogleButton()

    return () => {
      cancelled = true
    }
  }, [clientId, isNativeIos, onCredential])

  const handleNativeGoogleSignIn = async () => {
    if (!nativeClientId) {
      setLocalError("Missing VITE_GOOGLE_IOS_CLIENT_ID (or VITE_GOOGLE_CLIENT_ID) in web client env.")
      return
    }
    if (!serverClientId) {
      setLocalError("Missing VITE_GOOGLE_CLIENT_ID in web client env.")
      return
    }

    setLocalError("")
    setIsNativeSigningIn(true)

    try {
      await SocialLogin.initialize({
        google: {
          iOSClientId: nativeClientId,
          iOSServerClientId: serverClientId,
          webClientId: serverClientId,
          mode: "online",
        },
      })

      const response = await SocialLogin.login({
        provider: "google",
        options: {
          scopes: GOOGLE_SCOPES,
        },
      })

      const result = response?.result
      const credential =
        result && typeof result === "object" && "idToken" in result
          ? (result.idToken ?? "").toString().trim()
          : ""
      if (!credential) {
        throw new Error("Google sign-in completed but did not return an ID token.")
      }

      onCredential?.(credential)
    } catch (err) {
      setLocalError(err?.message || "Could not initialize native Google sign-in.")
    } finally {
      setIsNativeSigningIn(false)
    }
  }

  const effectiveError = errorText || localError
  const isSigningIn = isBusy || isNativeSigningIn

  return (
    <div className="min-h-screen bg-transparent text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-6 py-20">
        <div className="w-full rounded-2xl border border-[rgba(0,200,180,0.25)] bg-[rgba(0,20,35,0.72)] px-8 py-10 backdrop-blur-sm sm:px-12">
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-[var(--muted)] font-['Space_Mono',monospace]">
            Account Optional
          </div>
          <h1 className="mb-3 text-3xl font-black tracking-[-0.02em] text-[var(--cream)] sm:text-4xl">
            Sign in with Google
          </h1>
          <p className="mb-8 text-sm text-[var(--muted)] font-['Syne',sans-serif]">
            Sign in to sync your constraints. You can also continue as a guest.
          </p>

          <div className="w-full max-w-[320px]">
            {isNativeIos ? (
              <button
                type="button"
                onClick={handleNativeGoogleSignIn}
                disabled={isSigningIn}
                className="mb-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-full border border-white/30 bg-white px-6 text-sm font-semibold text-[#202124] transition hover:bg-[#f4f4f4] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSigningIn ? "Signing in..." : "Continue with Google"}
              </button>
            ) : (
              <div ref={buttonRef} className="mb-3 min-h-[44px] w-full" />
            )}

            {!isSigningIn ? (
              <button
                type="button"
                onClick={() => onContinueAsGuest?.()}
                className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full border border-[rgba(160,194,210,0.55)] bg-[rgba(151,186,204,0.14)] px-6 text-sm font-semibold text-[rgba(220,234,243,0.98)] transition hover:bg-[rgba(151,186,204,0.22)]"
              >
                Continue as Guest
              </button>
            ) : null}
          </div>

          {isSigningIn ? (
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)] font-['Space_Mono',monospace]">
              Signing in...
            </div>
          ) : null}

          {effectiveError ? (
            <div className="mt-3 text-xs text-[#ff6b6b] font-['Space_Mono',monospace]">
              {effectiveError}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
