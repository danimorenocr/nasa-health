import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float, OrbitControls, useAnimations, useGLTF } from '@react-three/drei'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'

function AstronautModel() {
  const group = useRef()
  const { scene, animations } = useGLTF('/assets/animated_floating_astronaut_in_space_suit_loop.glb')
  const model = useMemo(() => clone(scene), [scene])
  const { actions } = useAnimations(animations, group)

  useEffect(() => {
    const action = actions.Animation || Object.values(actions)[0]
    action?.reset().fadeIn(0.5).play()
    return () => action?.fadeOut(0.25)
  }, [actions])

  useFrame((state) => {
    if (!group.current) return
    group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.24) * 0.1
  })

  return (
    <Float speed={1.15} rotationIntensity={0.06} floatIntensity={0.28}>
      <primitive ref={group} object={model} position={[0, -2.05, 0]} rotation={[0, 0, -0.13]} scale={1.22} />
    </Float>
  )
}

function LoadingModel() {
  return (
    <div className="login-model__loading" role="status">
      <span />
      Cargando astronauta
    </div>
  )
}

export default function LoginAstronaut() {
  return (
    <div className="login-model">
      <div className="login-model__aura" />
      <Suspense fallback={<LoadingModel />}>
        <Canvas
          camera={{ position: [0, 0, 10.8], fov: 32 }}
          dpr={[1, 1.7]}
          gl={{ alpha: true, antialias: true }}
        >
          <ambientLight intensity={1.45} color="#a9ddff" />
          <directionalLight position={[4, 7, 6]} intensity={5.5} color="#e1f8ff" />
          <pointLight position={[-4, 2, 4]} intensity={17} color="#19bfff" distance={12} />
          <pointLight position={[4, 0, 2]} intensity={12} color="#168dff" distance={10} />
          <AstronautModel />
          <OrbitControls
            target={[0, 0, 0]}
            enablePan={false}
            enableZoom={false}
            enableDamping
            dampingFactor={0.1}
            rotateSpeed={1.4}
            minPolarAngle={Math.PI / 2}
            maxPolarAngle={Math.PI / 2}
          />
        </Canvas>
      </Suspense>
    </div>
  )
}

useGLTF.preload('/assets/animated_floating_astronaut_in_space_suit_loop.glb')
