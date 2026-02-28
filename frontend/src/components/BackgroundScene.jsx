import { useMemo } from "react"

export default function BackgroundScene() {
  const stars = useMemo(() => {
    let seed = 421337
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }

    return Array.from({ length: 28 }, (_, i) => {
      const size = 1.2 + rand() * 2.2
      const opacity = 0.74 + rand() * 0.26
      const bright = rand() > 0.72

      return {
        id: `star-${i}`,
        left: `${4 + rand() * 92}%`,
        top: `${4 + rand() * 78}%`,
        size: `${size.toFixed(2)}px`,
        opacity: Number(opacity.toFixed(2)),
        bright,
      }
    })
  }, [])

  return (
    <div id="bg-canvas" aria-hidden="true">
      <div className="ocean-glow"></div>
      <div className="starfield">
        {stars.map((star) => (
          <span
            key={star.id}
            className={`bg-star${star.bright ? " bg-star-bright" : ""}`}
            style={{
              left: star.left,
              top: star.top,
              width: star.size,
              height: star.size,
              opacity: star.opacity,
            }}
          />
        ))}
      </div>
    </div>
  )
}
