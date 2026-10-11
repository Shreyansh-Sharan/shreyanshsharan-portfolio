// Animated flowing-ribbon background in a single fragment shader. No 3D library needed.
import { useEffect, useRef } from 'react'
import { RIBBON_FRAG as FRAG, hexToRgb } from '../lib/ribbons'

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`



export function Background({ accent }: { accent: [string, string] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const target = useRef({ a: hexToRgb(accent[0]), b: hexToRgb(accent[1]) })
  const redraw = useRef<() => void>(() => {})

  useEffect(() => {
    target.current = { a: hexToRgb(accent[0]), b: hexToRgb(accent[1]) }
    redraw.current()
  }, [accent])

  useEffect(() => {
    const canvas = canvasRef.current!
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' })
    if (!gl) {
      canvas.dataset.fallback = 'true'
      return
    }

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      canvas.dataset.fallback = 'true'
      return
    }
    gl.useProgram(prog)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    const uRes = gl.getUniformLocation(prog, 'uRes')
    const uTime = gl.getUniformLocation(prog, 'uTime')
    const uA = gl.getUniformLocation(prog, 'uA')
    const uB = gl.getUniformLocation(prog, 'uB')

    // Render below native resolution: the image is soft by design, and this keeps the GPU cost tiny.
    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.5
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale))
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale))
      gl.viewport(0, 0, canvas.width, canvas.height)
    }
    resize()

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const cur = { a: [...target.current.a], b: [...target.current.b] }
    let time = 8
    let last = performance.now()
    let raf = 0

    const draw = () => {
      gl.uniform2f(uRes, canvas.width, canvas.height)
      gl.uniform1f(uTime, time)
      gl.uniform3fv(uA, cur.a)
      gl.uniform3fv(uB, cur.b)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      time += dt
      const k = 1 - Math.exp(-dt * 3.5)
      for (let i = 0; i < 3; i++) {
        cur.a[i] += (target.current.a[i] - cur.a[i]) * k
        cur.b[i] += (target.current.b[i] - cur.b[i]) * k
      }
      draw()
      raf = requestAnimationFrame(frame)
    }

    if (reduced) {
      redraw.current = () => {
        cur.a = [...target.current.a]
        cur.b = [...target.current.b]
        draw()
      }
      draw()
    } else {
      raf = requestAnimationFrame(frame)
    }

    const onVisibility = () => {
      if (reduced) return
      cancelAnimationFrame(raf)
      if (!document.hidden) {
        last = performance.now()
        raf = requestAnimationFrame(frame)
      }
    }
    const onResize = () => {
      resize()
      if (reduced) draw()
    }
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      redraw.current = () => {}
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="bg-canvas"
      aria-hidden="true"
      style={{ ['--bg-a' as string]: accent[0], ['--bg-b' as string]: accent[1] }}
    />
  )
}
