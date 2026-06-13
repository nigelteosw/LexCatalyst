import { useEffect, useRef, useState } from 'react'
import { GoogleLogin } from '@react-oauth/google'

export interface LoginPageProps {
  onLoginSuccess: (credential: string) => void
  onLoginError: (message: string) => void
  error?: string | null
}

type Particle = { x: number; y: number; vx: number; vy: number; r: number; hue: number }

export function LoginPage({ onLoginSuccess, onLoginError, error }: LoginPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const googleContainerRef = useRef<HTMLDivElement>(null)
  const [googleBtnWidth, setGoogleBtnWidth] = useState(280)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    let rafId: number
    let baseHue = 180

    const particles: Particle[] = Array.from({ length: 28 }, () => ({
      x: Math.random() * canvas.offsetWidth,
      y: Math.random() * canvas.offsetHeight,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      r: Math.random() * 2.5 + 0.8,
      hue: Math.random() * 60 + 150,
    }))

    function resize() {
      const w = canvas!.offsetWidth
      const h = canvas!.offsetHeight
      canvas!.width = w * dpr
      canvas!.height = h * dpr
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    function tick() {
      if (!ctx || !canvas) return
      const W = canvas.offsetWidth
      const H = canvas.offsetHeight

      ctx.clearRect(0, 0, W, H)

      // Dot grid
      const step = 36
      for (let gx = 0; gx <= W; gx += step) {
        for (let gy = 0; gy <= H; gy += step) {
          ctx.beginPath()
          ctx.arc(gx, gy, 1, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(0,0,0,0.07)'
          ctx.fill()
        }
      }

      // Update + draw particles
      particles.forEach((p) => {
        p.x += p.vx
        p.y += p.vy
        if (p.x < 0 || p.x > W) p.vx *= -1
        if (p.y < 0 || p.y > H) p.vy *= -1

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${p.hue}, 55%, 65%, 0.55)`
        ctx.fill()
      })

      // Connect nearby pairs
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d < 130) {
            const alpha = 0.18 * (1 - d / 130)
            ctx.beginPath()
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.strokeStyle = `hsla(${baseHue}, 45%, 60%, ${alpha})`
            ctx.lineWidth = 0.8
            ctx.stroke()
          }
        }
      }

      baseHue = (baseHue + 0.08) % 360
      rafId = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(rafId)
      ro.disconnect()
    }
  }, [])

  useEffect(() => {
    const el = googleContainerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setGoogleBtnWidth(Math.floor(entry.contentRect.width))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="login-pearl-bg app-scroll-region relative flex h-full min-h-0 w-full overflow-y-auto">
      {/* Canvas generative layer */}
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full opacity-70"
        style={{ mixBlendMode: 'multiply' }}
      />

      {/* Top nav */}
      <nav className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between border-b border-black/10 bg-white/40 px-5 py-2.5 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 border border-neutral-900 bg-neutral-900" />
          <span className="font-mono text-xs font-semibold tracking-widest text-neutral-900">
            LEXCATALYST
          </span>
          <span className="ml-1 border border-neutral-300 px-1 py-px font-mono text-[9px] text-neutral-400">
            v1.0
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden font-mono text-[10px] text-neutral-400 sm:inline">
            ● SECURE
          </span>
          <div className="hidden h-3 w-px bg-neutral-200 sm:block" />
          <span className="font-mono text-[10px] text-neutral-400">AUTH MODULE</span>
        </div>
      </nav>

      {/* Body */}
      <div className="relative z-10 flex min-h-full w-full flex-col pt-12 lg:flex-row">
        {/* Left branding */}
        <div className="flex flex-1 flex-col justify-center px-8 py-16 lg:px-16 lg:py-24">
          <div className="mx-auto w-full max-w-xl">
            {/* Status badge */}
            <div className="mb-8 inline-flex items-center gap-2 border border-dashed border-neutral-300 bg-white/60 px-3 py-1.5 backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-[#84cc16]" />
              <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                Legal Intelligence Platform · SG
              </span>
            </div>

            {/* Hero type */}
            <h1 className="text-5xl font-extralight leading-none tracking-tight text-neutral-900 sm:text-6xl lg:text-7xl">
              Lex
              <br />
              <span className="font-semibold">Catalyst</span>
            </h1>
            <p className="mt-5 max-w-sm text-base font-light leading-relaxed text-neutral-500">
              The AI-native workflow layer for modern law firms. Built for speed, trust, and the human behind every matter.
            </p>

            {/* Feature grid */}
            <div className="mt-10 grid grid-cols-2 gap-px border border-neutral-200 bg-neutral-200">
              {FEATURES.map((feat) => (
                <div
                  key={feat.label}
                  className="group flex flex-col gap-1 bg-white p-4 transition-colors duration-150 hover:bg-[#f7ffe6]"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] text-[#65a30d]">{feat.glyph}</span>
                    <span className="font-mono text-[10px] font-bold tracking-widest text-neutral-900">
                      {feat.label}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500">{feat.desc}</p>
                </div>
              ))}
            </div>

            {/* Status strip */}
            <div className="mt-8 flex items-center gap-3 border-l-2 border-[#a3e635] pl-3">
              <span className="font-mono text-[10px] text-neutral-400">
                SYS: OPERATIONAL &nbsp;·&nbsp; ENC: TLS 1.3 &nbsp;·&nbsp; AUTH: OAUTH 2.0
              </span>
            </div>
          </div>
        </div>

        {/* Vertical divider (desktop) */}
        <div className="hidden w-px bg-neutral-200 lg:block" />

        {/* Right login panel */}
        <div className="flex shrink-0 items-center justify-center px-8 pb-16 lg:w-[420px] lg:pb-0 lg:pt-16">
          <div className="w-full max-w-sm">
            {/* Window chrome titlebar */}
            <div className="flex items-center gap-1.5 border border-b-0 border-neutral-300 bg-neutral-100 px-3 py-2">
              <div className="h-2 w-2 rounded-full bg-neutral-300" />
              <div className="h-2 w-2 rounded-full bg-neutral-300" />
              <div className="h-2 w-2 rounded-full bg-[#a3e635]" />
              <span className="ml-2 font-mono text-[10px] text-neutral-400">
                auth.connect — workspace
              </span>
            </div>

            {/* Card body */}
            <div className="border border-neutral-300 bg-white px-8 py-8">
              <div className="mb-6">
                <span className="font-mono text-[10px] text-[#65a30d]">// AUTHENTICATE</span>
                <h2 className="mt-1.5 text-2xl font-light tracking-tight text-neutral-900">
                  Sign in to workspace
                </h2>
                <p className="mt-1 text-xs text-neutral-500">
                  Use your firm Google account to access LexCatalyst.
                </p>
              </div>

              {error && (
                <div className="mb-5 border border-red-200 bg-red-50 p-3 font-mono text-[11px] text-red-600">
                  <span className="text-red-400">ERR {'>'}</span> {error}
                </div>
              )}

              <div className="mb-5 flex items-center gap-3">
                <div className="h-px flex-1 border-t border-dashed border-neutral-200" />
                <span className="font-mono text-[10px] text-neutral-400">IDENTITY PROVIDER</span>
                <div className="h-px flex-1 border-t border-dashed border-neutral-200" />
              </div>

              {/* Google button — width measured from container so it never overflows */}
              <div ref={googleContainerRef} className="w-full overflow-hidden">
                <GoogleLogin
                  onSuccess={(cred) => {
                    if (cred.credential) onLoginSuccess(cred.credential)
                  }}
                  onError={() => onLoginError('Google sign-in failed. Please try again.')}
                  useOneTap
                  shape="rectangular"
                  theme="outline"
                  width={String(googleBtnWidth)}
                />
              </div>

              {/* Terms */}
              <div className="mt-6 border-t border-dashed border-neutral-200 pt-4">
                <p className="text-center font-mono text-[10px] leading-relaxed text-neutral-400">
                  By signing in, you agree to our{' '}
                  <span className="cursor-pointer text-neutral-600 underline underline-offset-2">
                    Terms
                  </span>{' '}
                  &amp;{' '}
                  <span className="cursor-pointer text-neutral-600 underline underline-offset-2">
                    Privacy Policy
                  </span>
                </p>
              </div>
            </div>

            {/* Statusbar footer */}
            <div className="flex items-center justify-between border border-t-0 border-neutral-300 bg-neutral-50 px-3 py-2">
              <span className="font-mono text-[10px] text-neutral-400">JWT · PKCE · OAUTH 2.0</span>
              <span className="font-mono text-[10px] text-[#84cc16]">● ONLINE</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const FEATURES = [
  { glyph: '◆', label: 'BIRDIE', desc: 'AI mentor & doc reviewer' },
  { glyph: '◈', label: 'LEX-WIKI', desc: 'Firm knowledge graph' },
  { glyph: '◉', label: 'ACTIONS', desc: 'Matter triage & delegation' },
  { glyph: '◎', label: 'WELLBEING', desc: 'Team health signals' },
]
