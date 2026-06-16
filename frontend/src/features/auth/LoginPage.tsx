import { useEffect, useRef, useState } from 'react'
import { GoogleLogin } from '@react-oauth/google'

export interface LoginPageProps {
  onLoginSuccess: (credential: string) => void
  onLoginError: (message: string) => void
  error?: string | null
}

type Particle = { x: number; y: number; vx: number; vy: number; r: number }

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

    const particles: Particle[] = Array.from({ length: 28 }, () => ({
      x: Math.random() * canvas.offsetWidth,
      y: Math.random() * canvas.offsetHeight,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      r: Math.random() * 2 + 0.6,
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
          ctx.arc(gx, gy, 0.8, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(255,255,255,0.07)'
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
        ctx.fillStyle = 'rgba(255,255,255,0.35)'
        ctx.fill()
      })

      // Connect nearby pairs
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d < 130) {
            const alpha = 0.12 * (1 - d / 130)
            ctx.beginPath()
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.strokeStyle = `rgba(255,255,255,${alpha})`
            ctx.lineWidth = 0.7
            ctx.stroke()
          }
        }
      }

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
    <div className="app-scroll-region relative flex h-full min-h-0 w-full overflow-y-auto bg-[#0f0f0f]">
      {/* Canvas generative layer */}
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full"
      />

      {/* Top nav */}
      <nav className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between border-b border-white/10 bg-[#0f0f0f]/80 px-5 py-2.5 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 bg-white" />
          <span className="font-mono text-xs font-semibold tracking-widest text-white">
            LEXCATALYST
          </span>
          <span className="ml-1 border border-white/20 px-1 py-px font-mono text-[9px] text-white/30">
            v1.0
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden font-mono text-[10px] text-white/30 sm:inline">
            ● SECURE
          </span>
          <div className="hidden h-3 w-px bg-white/10 sm:block" />
          <span className="font-mono text-[10px] text-white/30">AUTH MODULE</span>
        </div>
      </nav>

      {/* Body */}
      <div className="relative z-10 flex min-h-full w-full flex-col pt-12 lg:flex-row">
        {/* Left branding */}
        <div className="flex flex-1 flex-col justify-center px-8 py-16 lg:px-16 lg:py-24">
          <div className="mx-auto w-full max-w-xl">
            {/* Status badge */}
            <div className="mb-8 inline-flex items-center gap-2 border border-dashed border-white/20 bg-white/5 px-3 py-1.5 backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-[#2d9e6b]" />
              <span className="font-mono text-[10px] uppercase tracking-widest text-white/50">
                Legal Intelligence Platform · SG
              </span>
            </div>

            {/* Hero type */}
            <h1 className="text-5xl font-extralight leading-none tracking-tight text-white sm:text-6xl lg:text-7xl">
              Lex
              <br />
              <span className="font-semibold">Catalyst</span>
            </h1>
            <p className="mt-5 max-w-sm text-base font-light leading-relaxed text-white/40">
              The AI-native workflow layer for modern law firms. Built for speed, trust, and the human behind every matter.
            </p>

            {/* Feature grid */}
            <div className="mt-10 grid grid-cols-2 gap-px border border-white/10 bg-white/10">
              {FEATURES.map((feat) => (
                <div
                  key={feat.label}
                  className="group flex flex-col gap-1 bg-[#0f0f0f] p-4 transition-colors duration-150 hover:bg-white/5"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] text-[#2d9e6b]">{feat.glyph}</span>
                    <span className="font-mono text-[10px] font-bold tracking-widest text-white">
                      {feat.label}
                    </span>
                  </div>
                  <p className="text-xs text-white/40">{feat.desc}</p>
                </div>
              ))}
            </div>

            {/* Status strip */}
            <div className="mt-8 flex items-center gap-3 border-l-2 border-[#2d9e6b] pl-3">
              <span className="font-mono text-[10px] text-white/30">
                SYS: OPERATIONAL &nbsp;·&nbsp; ENC: TLS 1.3 &nbsp;·&nbsp; AUTH: OAUTH 2.0
              </span>
            </div>
          </div>
        </div>

        {/* Vertical divider (desktop) */}
        <div className="hidden w-px bg-white/10 lg:block" />

        {/* Right login panel */}
        <div className="flex shrink-0 items-center justify-center px-8 pb-16 lg:w-[420px] lg:pb-0 lg:pt-16">
          <div className="w-full max-w-sm">
            {/* Window chrome titlebar */}
            <div className="flex items-center gap-1.5 border border-b-0 border-white/10 bg-white/5 px-3 py-2">
              <div className="h-2 w-2 rounded-full bg-white/20" />
              <div className="h-2 w-2 rounded-full bg-white/20" />
              <div className="h-2 w-2 rounded-full bg-[#2d9e6b]" />
              <span className="ml-2 font-mono text-[10px] text-white/30">
                auth.connect — workspace
              </span>
            </div>

            {/* Card body */}
            <div className="border border-white/10 bg-[#161616] px-8 py-8">
              <div className="mb-6">
                <span className="font-mono text-[10px] text-[#2d9e6b]">// AUTHENTICATE</span>
                <h2 className="mt-1.5 text-2xl font-light tracking-tight text-white">
                  Sign in to workspace
                </h2>
                <p className="mt-1 text-xs text-white/40">
                  Use your firm Google account to access LexCatalyst.
                </p>
              </div>

              {error && (
                <div className="mb-5 border border-red-500/20 bg-red-500/10 p-3 font-mono text-[11px] text-red-400">
                  <span className="text-red-500/70">ERR {'>'}</span> {error}
                </div>
              )}

              <div className="mb-5 flex items-center gap-3">
                <div className="h-px flex-1 border-t border-dashed border-white/10" />
                <span className="font-mono text-[10px] text-white/25">IDENTITY PROVIDER</span>
                <div className="h-px flex-1 border-t border-dashed border-white/10" />
              </div>

              {/* Google button */}
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
              <div className="mt-6 border-t border-dashed border-white/10 pt-4">
                <p className="text-center font-mono text-[10px] leading-relaxed text-white/25">
                  By signing in, you agree to our{' '}
                  <span className="cursor-pointer text-white/50 underline underline-offset-2">
                    Terms
                  </span>{' '}
                  &amp;{' '}
                  <span className="cursor-pointer text-white/50 underline underline-offset-2">
                    Privacy Policy
                  </span>
                </p>
              </div>
            </div>

            {/* Statusbar footer */}
            <div className="flex items-center justify-between border border-t-0 border-white/10 bg-[#0d0d0d] px-3 py-2">
              <span className="font-mono text-[10px] text-white/20">JWT · PKCE · OAUTH 2.0</span>
              <span className="font-mono text-[10px] text-[#2d9e6b]">● ONLINE</span>
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
  { glyph: '◉', label: 'WORKBOARD', desc: 'Matter triage & delegation' },
  { glyph: '◎', label: 'WELLBEING', desc: 'Team health signals' },
]
