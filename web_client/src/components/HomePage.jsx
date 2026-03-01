import React, { useEffect, useState } from "react";
import NavBar from "./NavBar";

export default function HomePage({ onGetStarted }) {
    const [hideScrollCue, setHideScrollCue] = useState(false);

    useEffect(() => {
        const onScroll = () => setHideScrollCue(window.scrollY > 40);
        onScroll();
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    const handleNavCta = () => {
        onGetStarted?.();
    };

    const handleHeroCta = (e) => {
        e.preventDefault();
        onGetStarted?.();
    };

    return (
        <div>
            {/* Nav */}
            <NavBar
                onCta={handleNavCta}
                onLogoClick={() =>
                    window.scrollTo({ top: 0, behavior: "smooth" })
                }
                logoHref="#top"
            />

            {/* Hero */}
            <section id="hero">
                <div className="hero-eyebrow">
                    Built for Hackers, by Hackers
                </div>
                <h1>
                    <span className="line1">Find hackathons</span>
                    <span className="line2">built around your life.</span>
                </h1>
                <p className="hero-sub">
                    Tell us your schedule, budget, and where your friends are.
                    HackTrack finds the best hackathons you can realistically
                    attend — calculating flights, costs, and whether a
                    friend&apos;s couch saves you $200.
                </p>
                <div className="hero-actions">
                    <a
                        href="#cta"
                        className="btn-primary"
                        onClick={handleHeroCta}
                    >
                        ⚡ Find My Hackathons
                    </a>
                    <a href="#how" className="btn-ghost">
                        ↓ See How It Works
                    </a>
                </div>
                <div className="hero-stats">
                    <div className="stat-item">
                        <span className="stat-val">500+</span>
                        <span className="stat-label">Hackathons tracked</span>
                    </div>
                    <div className="stat-divider"></div>
                    <div className="stat-item">
                        <span className="stat-val">MLH, Devpost, Devfolio</span>
                        <span className="stat-label">Data sources</span>
                    </div>
                    <div className="stat-divider"></div>
                    <div className="stat-item">
                        <span className="stat-val">Real flights</span>
                        <span className="stat-label">Cost estimates</span>
                    </div>
                </div>
                <div
                    className={`scroll-down ${hideScrollCue ? "is-hidden" : ""}`}
                >
                    <span className="scroll-down-text">scroll</span>
                    <div className="scroll-down-line"></div>
                </div>
            </section>

            {/* How it works */}
            <section id="how">
                <div className="section-label">The Process</div>
                <h2 className="section-title">
                    From your schedule to <em>ranked results</em>
                </h2>
                <p className="section-sub">
                    Four inputs. One ranked list. Zero manual research.
                </p>
                <div className="steps-grid">
                    <div className="step-card">
                        <div className="step-num">01</div>
                        <div className="step-icon">🏠</div>
                        <h3>Enter Your Details</h3>
                        <p>
                            Your home city, class schedule, Friday/Monday time
                            constraints, and total weekend budget. Takes 30
                            seconds.
                        </p>
                    </div>
                    <div className="step-card">
                        <div className="step-num">02</div>
                        <div className="step-icon">👥</div>
                        <h3>Add Friend Locations</h3>
                        <p>
                            Drop in where your friends live. If they&apos;re
                            near an event city, you might crash with them —
                            saving $100+ on lodging.
                        </p>
                    </div>
                    <div className="step-card">
                        <div className="step-num">03</div>
                        <div className="step-icon">✈️</div>
                        <h3>We Run the Math</h3>
                        <p>
                            Flight prices, travel times, feasibility checks
                            against your class schedule, prize pools, timezone
                            calculations — all automated.
                        </p>
                    </div>
                    <div className="step-card">
                        <div className="step-num">04</div>
                        <div className="step-icon">🏆</div>
                        <h3>Get Ranked Results</h3>
                        <p>
                            A scored, sorted list of hackathons you can actually
                            attend. Prize-to-cost ratio, travel time, and friend
                            proximity all factor in.
                        </p>
                    </div>
                </div>
            </section>

            {/* Features */}
            <section id="features">
                <div className="section-label">What Makes Us Different</div>
                <h2 className="section-title">
                    Smart filters. <em>Real constraints.</em>
                </h2>
                <p className="section-sub">
                    Not just a list of hackathons — a decision engine built
                    around your life.
                </p>
                <div className="features-grid">
                    <div className="feat-card">
                        <div className="feat-icon">🛫</div>
                        <div className="feat-body">
                            <h3>Real Flight Cost Estimates</h3>
                            <p>
                                Precomputed average outbound Friday and return
                                Sunday flight prices from your home airport. We
                                surface the true cost of attendance, not just
                                the registration fee — so you can budget
                                accurately before committing.
                            </p>
                        </div>
                    </div>
                    <div className="feat-card">
                        <div className="feat-icon">🕐</div>
                        <div className="feat-body">
                            <h3>Class Schedule Feasibility</h3>
                            <p>
                                No more missing Monday 8am. We check flight
                                arrival times against your first class, and
                                departure against your last Friday class —
                                automatically filtering events that simply
                                won&apos;t work.
                            </p>
                        </div>
                    </div>
                    <div className="feat-card">
                        <div className="feat-icon">🌍</div>
                        <div className="feat-body">
                            <h3>Timezone-Aware Logic</h3>
                            <p>
                                Events span timezones. We normalize everything
                                to UTC so a 6pm check-in in San Francisco
                                doesn&apos;t silently conflict with your 9pm
                                flight out of New York.
                            </p>
                        </div>
                    </div>
                    <div className="feat-card">
                        <div className="feat-icon">👫</div>
                        <div className="feat-body">
                            <h3>Friend Proximity Bonus</h3>
                            <p>
                                Friends near an event city can mean free
                                lodging. Our scoring engine gives a boost to
                                events where your friends are nearby — turning
                                social connections into real cost savings.
                            </p>
                        </div>
                    </div>
                    <div className="feat-card">
                        <div className="feat-icon">💎</div>
                        <div className="feat-body">
                            <h3>Prize-to-Cost Optimization</h3>
                            <p>
                                We rank by prize pool divided by trip cost — so
                                a $5k hackathon you can drive to beats a $50k
                                hackathon that costs $800 in flights. Smart ROI,
                                not just prestige.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Score preview */}
            <section id="score-viz">
                <div className="section-label">Live Score Breakdown</div>
                <h2 className="section-title">
                    See exactly <em>why</em> an event ranks
                </h2>
                <p className="section-sub">
                    Every result comes with a transparent score breakdown. No
                    black boxes.
                </p>
                <div className="score-demo-wrap">
                    <div className="demo-card">
                        <div className="demo-card-header">
                            <div>
                                <div className="event-name">HackMIT 2026</div>
                                <div className="event-city">
                                    📍 Cambridge, MA · Apr 4–6
                                </div>
                            </div>
                            <div className="score-badge">9.2</div>
                        </div>
                        <div className="score-bars">
                            <div className="score-row">
                                <div className="score-row-meta">
                                    <span>prize_score</span>
                                    <span>0.88</span>
                                </div>
                                <div className="bar-track">
                                    <div className="bar-fill bar-prize"></div>
                                </div>
                            </div>
                            <div className="score-row">
                                <div className="score-row-meta">
                                    <span>prize_to_cost</span>
                                    <span>0.72</span>
                                </div>
                                <div className="bar-track">
                                    <div className="bar-fill bar-roi"></div>
                                </div>
                            </div>
                            <div className="score-row">
                                <div className="score-row-meta">
                                    <span>travel_time</span>
                                    <span>0.65</span>
                                </div>
                                <div className="bar-track">
                                    <div className="bar-fill bar-travel"></div>
                                </div>
                            </div>
                            <div className="score-row">
                                <div className="score-row-meta">
                                    <span>friend_bonus</span>
                                    <span>1.00 ★</span>
                                </div>
                                <div className="bar-track">
                                    <div className="bar-fill bar-friend"></div>
                                </div>
                            </div>
                        </div>
                        <div className="demo-meta">
                            <div className="meta-item">
                                <div className="meta-label">
                                    Est. Flight Cost
                                </div>
                                <div className="meta-value gold">
                                    $187 round trip
                                </div>
                            </div>
                            <div className="meta-item">
                                <div className="meta-label">Travel Time</div>
                                <div className="meta-value">
                                    2h 15m each way
                                </div>
                            </div>
                            <div className="meta-item">
                                <div className="meta-label">Prize Pool</div>
                                <div className="meta-value gold">$25,000</div>
                            </div>
                            <div className="meta-item">
                                <div className="meta-label">Friend Nearby</div>
                                <div className="meta-value green">
                                    ✓ Alex (Boston)
                                </div>
                            </div>
                        </div>
                    </div>

                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "1rem",
                        }}
                    >
                        <div className="demo-card">
                            <div className="demo-card-header">
                                <div>
                                    <div className="event-name">
                                        TreeHacks 2026
                                    </div>
                                    <div className="event-city">
                                        📍 Stanford, CA · Feb 14–16
                                    </div>
                                </div>
                                <div
                                    className="score-badge"
                                    style={{
                                        background:
                                            "linear-gradient(135deg,#00E5CC,#00bfa5)",
                                        color: "#060E18",
                                    }}
                                >
                                    7.8
                                </div>
                            </div>
                            <div
                                className="demo-meta"
                                style={{
                                    borderTop: "none",
                                    paddingTop: 0,
                                    marginTop: 0,
                                }}
                            >
                                <div className="meta-item">
                                    <div className="meta-label">
                                        Est. Flight
                                    </div>
                                    <div className="meta-value gold">$312</div>
                                </div>
                                <div className="meta-item">
                                    <div className="meta-label">Prize Pool</div>
                                    <div className="meta-value gold">
                                        $15,000
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div
                            className="demo-card"
                            style={{ borderColor: "rgba(0,229,204,0.15)" }}
                        >
                            <p
                                style={{
                                    fontSize: "0.78rem",
                                    color: "var(--muted)",
                                    lineHeight: 1.7,
                                }}
                            >
                                <strong style={{ color: "var(--teal)" }}>
                                    Scoring formula:
                                </strong>
                                <br />
                                <code
                                    style={{
                                        fontFamily: "'Space Mono',monospace",
                                        fontSize: "0.7rem",
                                        color: "var(--gold)",
                                    }}
                                >
                                    score = 0.35·prize
                                    <br />
                                    &nbsp;&nbsp;&nbsp;&nbsp;+ 0.30·roi
                                    <br />
                                    &nbsp;&nbsp;&nbsp;&nbsp;+ 0.20·travel
                                    <br />
                                    &nbsp;&nbsp;&nbsp;&nbsp;+ 0.15·friends
                                </code>
                                <br />
                                <br />
                                Weights are tunable live during demos. You
                                control what matters most.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* CTA */}
            <section id="cta">
                <div className="cta-glow">
                    <h2>
                        Ready to hack <span>smarter</span>?
                    </h2>
                </div>
                <p>
                    Join the waitlist and be first to find your perfect
                    hackathon weekend — before your competitors do.
                </p>
                <div className="early-form">
                    <input type="email" placeholder="your@email.com" />
                    <button className="btn-primary">Join Waitlist →</button>
                </div>
                <p className="form-note">No spam. Just your next hackathon.</p>
            </section>

            {/* Footer */}
            <footer>
                <div className="logo">HackTrack</div>
                <span>Built at a hackathon. Naturally.</span>
            </footer>
        </div>
    );
}
