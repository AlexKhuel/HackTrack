import { useEffect, useRef, useState } from "react"

const GOOGLE_IDENTITY_SCRIPT_ID = "google-identity-services-script"
const GOOGLE_IDENTITY_SCRIPT_SRC = "https://accounts.google.com/gsi/client"

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

export default function GoogleSignInPage({ onCredential, errorText = "", isBusy = false }) {
  const buttonRef = useRef(null)
  const [localError, setLocalError] = useState("")
  const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "").toString().trim()

  useEffect(() => {
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
  }, [clientId, onCredential])

  const effectiveError = errorText || localError

  return (
    <div className="min-h-screen bg-transparent text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-6 py-20">
        <div className="w-full rounded-2xl border border-[rgba(0,200,180,0.25)] bg-[rgba(0,20,35,0.72)] px-8 py-10 backdrop-blur-sm sm:px-12">
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-[var(--muted)] font-['Space_Mono',monospace]">
            Account Required
          </div>
          <h1 className="mb-3 text-3xl font-black tracking-[-0.02em] text-[var(--cream)] sm:text-4xl">
            Sign in with Google
          </h1>
          <p className="mb-8 text-sm text-[var(--muted)] font-['Syne',sans-serif]">
            We use your account to save your constraints and restore them later.
          </p>

          <div ref={buttonRef} className="mb-4 min-h-[44px]" />

          {isBusy ? (
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
