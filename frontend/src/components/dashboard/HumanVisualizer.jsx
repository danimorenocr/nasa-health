import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float, OrbitControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { useLanguage } from '../../app/LanguageContext'

/* ─── Quaternions para la pose de saludo y animación de la mano ─── */
const WAVE_UPPER_ARM_UP = new THREE.Quaternion(-0.4075, -0.6086, 0.3288, 0.5962)
const WAVE_FOREARM_UP = new THREE.Quaternion(0.2275, -0.1996, 0.1682, 0.9381)

/* Oscilaciones de la mano para el saludo */
const WAVE_HAND_A = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.32))
const WAVE_HAND_B = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.32))

function HologramModel({ isWaving, greetingSpeaking }) {
  const group = useRef()
  const { scene } = useGLTF('/assets/holograming_man.glb')
  const model = useMemo(() => scene.clone(true), [scene])
  const upperArmR = useRef(null)
  const forearmR = useRef(null)
  const handR = useRef(null)
  const wavePhase = useRef(0)

  useEffect(() => {
    model.traverse((node) => {
      if (!node.isMesh) return
      if (node.name.toLowerCase().includes('sphere')) {
        node.visible = false
        return
      }
      // Material holográfico wireframe azul brillante como en el video
      node.material = new THREE.MeshPhysicalMaterial({
        color: '#00c3ff',
        emissive: '#0095ff',
        emissiveIntensity: 1.6,
        wireframe: true,
        transparent: true,
        opacity: 0.85,
        roughness: 0.1,
        metalness: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    })

    // Captura de huesos del brazo derecho para la pose de saludo
    upperArmR.current = model.getObjectByName('upper_arm.R_030')
    forearmR.current = model.getObjectByName('forearm.R_031')
    handR.current = model.getObjectByName('hand.R_032')

    // Establecer la pose de saludo (brazo levantado como en el video)
    if (upperArmR.current) upperArmR.current.quaternion.copy(WAVE_UPPER_ARM_UP)
    if (forearmR.current) forearmR.current.quaternion.copy(WAVE_FOREARM_UP)
  }, [model])

  useFrame((state, delta) => {
    if (!group.current) return

    // Suave flotación / rotación idle del holograma
    group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.25) * 0.05

    // Movimiento fluido de la mano saludando: activo mientras habla
    if (handR.current) {
      if (greetingSpeaking) {
        wavePhase.current += delta * 5.4
        const swing = Math.sin(wavePhase.current)
        const handQ = new THREE.Quaternion()
        handQ.slerpQuaternions(WAVE_HAND_A, WAVE_HAND_B, (swing + 1) * 0.5)
        handR.current.quaternion.copy(handQ)
      } else {
        // En reposo sin audio, la mano se mantiene centrada y serena
        handR.current.quaternion.slerp(new THREE.Quaternion(), delta * 3)
      }
    }

    // Suave respiración / micro-oscilación del brazo
    if (upperArmR.current) {
      const breathe = Math.sin(state.clock.elapsedTime * 1.5) * 0.015
      const q = WAVE_UPPER_ARM_UP.clone()
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(breathe, 0, 0)))
      upperArmR.current.quaternion.copy(q)
    }
  })

  return (
    <Float speed={1.2} rotationIntensity={0} floatIntensity={0.08}>
      <group ref={group} scale={1.05} position={[0, -0.2, 0]}>
        <primitive object={model} />
      </group>
    </Float>
  )
}

function HologramFallback() {
  const { tr } = useLanguage()
  return (
    <div className="model-loading">
      <span />
      <p>{tr('Sincronizando modelo biométrico…', 'Syncing biometric model…')}</p>
    </div>
  )
}

export default function HumanVisualizer({ isWaving, onToggleGreeting, greetingSpeaking, greetingRun = 0 }) {
  const { tr } = useLanguage()

  return (
    <section className="human-visualizer-pro" aria-label={tr('Visualizador biométrico 3D', '3D biometric visualizer')}>
      {/* HUD holográfico lateral derecho */}
      <div className="hud-side-arcs" aria-hidden="true">
        <svg viewBox="0 0 100 200" fill="none" className="hud-side-arcs-svg">
          <path d="M 60 20 A 90 90 0 0 1 60 180" stroke="rgba(49, 220, 255, 0.45)" strokeWidth="1.8" />
          <path d="M 80 40 A 80 80 0 0 1 80 160" stroke="rgba(24, 150, 255, 0.3)" strokeWidth="1.2" strokeDasharray="6 4" />
          <path d="M 95 65 A 70 70 0 0 1 95 135" stroke="rgba(49, 220, 255, 0.6)" strokeWidth="2.5" />
        </svg>
      </div>

      {/* Columnas verticales de ecualizador de voz / sonido: SOLO cuando el audio está activo */}
      <div className={`hologram-equalizer-stage ${greetingSpeaking ? 'is-active' : ''}`} aria-hidden="true">
        {Array.from({ length: 20 }, (_, i) => (
          <div key={i} className="equalizer-beam" style={{ '--beam-idx': i }} />
        ))}
      </div>

      {/* Exactamente 7 ondas secuenciales que aparecen a lo largo de la locución (desde el inicio hasta el final) */}
      {greetingSpeaking && (
        <div key={greetingRun} className="hologram-rising-rings is-active" aria-hidden="true">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="hologram-scan-ring" style={{ '--ring-idx': i }} />
          ))}
        </div>
      )}

      {/* Anillos orbitales en la cadera */}
      <div className="hip-orbital-ring" aria-hidden="true" />
      <div className="hip-orbital-ring hip-orbital-ring--outer" aria-hidden="true" />

      {/* Pedestal de anillos concéntricos HUD en los pies */}
      <div className="feet-pedestal-platform" aria-hidden="true">
        <div className="pedestal-ring pedestal-ring--1" />
        <div className="pedestal-ring pedestal-ring--2" />
        <div className="pedestal-ring pedestal-ring--3" />
        <div className="pedestal-ring pedestal-ring--ticks" />
        <div className="pedestal-glow" />
      </div>

      <div className="scan-line" />

      {/* Canvas 3D Three.js */}
      <Suspense fallback={<HologramFallback />}>
        <Canvas
          camera={{ position: [0, 2.7, 13.5], fov: 32 }}
          dpr={[1, 1.8]}
          gl={{ alpha: true, antialias: true }}
        >
          <ambientLight intensity={0.5} color="#00e5ff" />
          <pointLight position={[2, 3, 4]} intensity={9} color="#00b4ff" distance={12} />
          <pointLight position={[-2, 1, 3]} intensity={7} color="#45f3ff" distance={10} />
          <HologramModel isWaving={isWaving} greetingSpeaking={greetingSpeaking} />
          <OrbitControls
            target={[0, 2.7, 0.5]}
            enableZoom={false}
            enablePan={false}
            minPolarAngle={Math.PI / 2}
            maxPolarAngle={Math.PI / 2}
          />
        </Canvas>
      </Suspense>

      {/* Botón flotante inferior derecho: Escuchar saludo / Play greeting */}
      {onToggleGreeting && (
        <button
          type="button"
          className={`greeting-play-btn ${greetingSpeaking ? 'is-active' : ''}`}
          onClick={onToggleGreeting}
          aria-label={greetingSpeaking
            ? tr('Detener saludo', 'Stop greeting')
            : tr('Escuchar saludo', 'Play greeting')}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {greetingSpeaking ? (
              <>
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </>
            ) : (
              <>
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </>
            )}
          </svg>
          <span>
            {greetingSpeaking
              ? tr('Detener saludo', 'Stop greeting')
              : tr('Escuchar saludo', 'Play greeting')}
          </span>
        </button>
      )}
    </section>
  )
}

useGLTF.preload('/assets/holograming_man.glb')
