import React from "react"

export default function NavBar({
  ctaLabel = "⚡ Get Started",
  onCta,
  ctaHref = "#cta",
  onLogoClick,
  logoHref = "#top",
  showLinks = true,
}) {
  const handleCta = (e) => {
    if (onCta) {
      e.preventDefault()
      onCta(e)
    }
  }

  const handleLogo = (e) => {
    if (onLogoClick) {
      e.preventDefault()
      onLogoClick()
    }
  }

  return (
    <nav>
      <a href={logoHref} className="logo" onClick={handleLogo}>
        HackTrack
      </a>
      <ul>
        {showLinks ? (
          <>
            <li>
              <a href="#how">How it Works</a>
            </li>
            <li>
              <a href="#features">Features</a>
            </li>
          </>
        ) : null}
        <li>
          {onCta ? (
            <button type="button" className="nav-cta nav-cta-btn" onClick={handleCta}>
              {ctaLabel}
            </button>
          ) : (
            <a href={ctaHref} className="nav-cta" onClick={handleCta}>
              {ctaLabel}
            </a>
          )}
        </li>
      </ul>
    </nav>
  )
}
