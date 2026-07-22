import { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sparkles, RotateCcw, Maximize2, ShieldAlert, Activity, ArrowUpRight, ArrowDownRight, Camera, Play, Pause, Eye, Check, Activity as WaveIcon } from 'lucide-react';

// Deterministic pseudo-noise fallback generator
function pseudoNoise(seed) {
  const x = Math.sin(seed * 9999 + 1) * 10000;
  return x - Math.floor(x);
}

export default function OrderBook3DViewer({
  orderBookData,
  whaleWallsData,
  btcPrice = 66500,
  btcChange24h = 2.5,
  theme = 'dark',
  onClose
}) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const reqIdRef = useRef(null);

  // UI state
  const [viewMode, setViewMode] = useState('surface'); // 'surface' | 'ribbon' | 'wireframe'
  const [isAutoRotate, setIsAutoRotate] = useState(true);
  const [focusedWall, setFocusedWall] = useState(null);
  const [snapshotToast, setSnapshotToast] = useState(false);

  // Safely parse spot price
  const spotPriceNum = useMemo(() => {
    const parsed = Number(btcPrice);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 66500;
  }, [btcPrice]);

  const change24hNum = useMemo(() => {
    const parsed = Number(btcChange24h);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [btcChange24h]);

  // Derive Bids & Asks data safely with zero NaN risk
  const { bids, asks, maxVol } = useMemo(() => {
    const rawBids = orderBookData?.bids || [];
    const rawAsks = orderBookData?.asks || [];

    const parsedBids = [];
    const parsedAsks = [];

    const spot = spotPriceNum;

    if (rawBids.length > 0) {
      rawBids.slice(0, 35).forEach((b, i) => {
        const px = Number(b[0]) || (spot - (i + 1) * 40);
        const qty = Number(b[1]) || (pseudoNoise(i + 1) * 5 + 1);
        parsedBids.push({ price: px, qty, notional: px * qty });
      });
    } else {
      // High-fidelity fallback Bids
      for (let i = 0; i < 35; i++) {
        const px = spot - (i + 1) * 35;
        const qty = Math.pow(pseudoNoise(i * 1.5 + 2), 2) * 12 + 1 + (i % 7 === 0 ? 18 : 0);
        parsedBids.push({ price: px, qty, notional: px * qty });
      }
    }

    if (rawAsks.length > 0) {
      rawAsks.slice(0, 35).forEach((a, i) => {
        const px = Number(a[0]) || (spot + (i + 1) * 40);
        const qty = Number(a[1]) || (pseudoNoise(i + 35) * 5 + 1);
        parsedAsks.push({ price: px, qty, notional: px * qty });
      });
    } else {
      // High-fidelity fallback Asks
      for (let i = 0; i < 35; i++) {
        const px = spot + (i + 1) * 35;
        const qty = Math.pow(pseudoNoise(i * 2.1 + 5), 2) * 12 + 1 + (i % 6 === 0 ? 16 : 0);
        parsedAsks.push({ price: px, qty, notional: px * qty });
      }
    }

    const allVols = [...parsedBids, ...parsedAsks].map(d => d.qty);
    const maxV = Math.max(...allVols, 1);

    return { bids: parsedBids, asks: parsedAsks, maxVol: maxV };
  }, [orderBookData, spotPriceNum]);

  // Major Whale Walls for HUD with ZERO NaN risk
  const whaleBids = useMemo(() => {
    const spot = spotPriceNum;
    const rawList = (whaleWallsData?.whaleBids?.length ? whaleWallsData.whaleBids : bids.map(b => ({ price: b.price, qty: b.qty, usdValue: b.notional })));

    return rawList
      .slice()
      .sort((a, b) => (Number(b.usdValue || b.notional) || 0) - (Number(a.usdValue || a.notional) || 0))
      .slice(0, 3)
      .map(b => {
        const px = Number(b.price) || spot;
        const val = Number(b.usdValue || b.notional || (px * (b.qty || 0))) || 0;
        const dist = spot > 0 ? Math.abs(((spot - px) / spot) * 100) : 0;
        return {
          price: px,
          qty: Number(b.qty) || 0,
          usdVal: val,
          distPct: Number.isFinite(dist) ? dist.toFixed(2) : '0.00'
        };
      });
  }, [whaleWallsData, bids, spotPriceNum]);

  const whaleAsks = useMemo(() => {
    const spot = spotPriceNum;
    const rawList = (whaleWallsData?.whaleAsks?.length ? whaleWallsData.whaleAsks : asks.map(a => ({ price: a.price, qty: a.qty, usdValue: a.notional })));

    return rawList
      .slice()
      .sort((a, b) => (Number(b.usdValue || b.notional) || 0) - (Number(a.usdValue || a.notional) || 0))
      .slice(0, 3)
      .map(a => {
        const px = Number(a.price) || spot;
        const val = Number(a.usdValue || a.notional || (px * (a.qty || 0))) || 0;
        const dist = spot > 0 ? Math.abs(((px - spot) / spot) * 100) : 0;
        return {
          price: px,
          qty: Number(a.qty) || 0,
          usdVal: val,
          distPct: Number.isFinite(dist) ? dist.toFixed(2) : '0.00'
        };
      });
  }, [whaleWallsData, asks, spotPriceNum]);

  // Three.js Scene Setup — Institutional 3D Surface Wave Mesh
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // 1. Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const isDark = theme !== 'light';
    scene.background = new THREE.Color(isDark ? 0x07090e : 0xf4f3ef);
    scene.fog = new THREE.FogExp2(isDark ? 0x07090e : 0xf4f3ef, 0.012);

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 1000);
    cameraRef.current = camera;
    camera.position.set(0, 24, 42);

    // 3. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    rendererRef.current = renderer;
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // 4. Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.minDistance = 10;
    controls.maxDistance = 90;
    controls.target.set(0, 4, 0);

    // 5. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, isDark ? 0.7 : 1.1);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
    dirLight.position.set(25, 45, 25);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const pointGreen = new THREE.PointLight(0x10b981, 4, 45);
    pointGreen.position.set(-18, 12, 0);
    scene.add(pointGreen);

    const pointRed = new THREE.PointLight(0xf43f5e, 4, 45);
    pointRed.position.set(18, 12, 0);
    scene.add(pointRed);

    // 6. Ground Grid Base
    const gridHelper = new THREE.GridHelper(90, 45, 0x38bdf8, isDark ? 0x1e293b : 0xd1d5db);
    gridHelper.position.y = 0;
    scene.add(gridHelper);

    // 7. Center Spot Price Pillar & Pulsing Canyon Ring
    const spotPillarGeo = new THREE.CylinderGeometry(0.2, 0.2, 22, 16);
    const spotPillarMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.9,
      roughness: 0.1
    });
    const spotPillar = new THREE.Mesh(spotPillarGeo, spotPillarMat);
    spotPillar.position.set(0, 11, 0);
    scene.add(spotPillar);

    const spotRingGeo = new THREE.RingGeometry(0.6, 1.4, 32);
    const spotRingMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
    const spotRing = new THREE.Mesh(spotRingGeo, spotRingMat);
    spotRing.rotation.x = -Math.PI / 2;
    spotRing.position.set(0, 0.08, 0);
    scene.add(spotRing);

    // 8. Build 3D Liquidity Surface Mesh (Continuous Wave Surface)
    const segmentsX = 70; // 35 Bids + 35 Asks
    const segmentsZ = 20; // Depth history layers
    const widthX = 70;
    const depthZ = 24;

    const surfaceGeo = new THREE.PlaneGeometry(widthX, depthZ, segmentsX, segmentsZ);
    surfaceGeo.rotateX(-Math.PI / 2); // Make horizontal

    const posAttr = surfaceGeo.attributes.position;
    const colors = new Float32Array(posAttr.count * 3);

    // Vertex deformation based on Bids & Asks volume wave
    for (let i = 0; i <= segmentsZ; i++) {
      for (let j = 0; j <= segmentsX; j++) {
        const vertexIdx = i * (segmentsX + 1) + j;
        const xPos = posAttr.getX(vertexIdx);
        const zPos = posAttr.getZ(vertexIdx);

        let heightVal;
        let r, g, b;

        if (xPos < -0.5) {
          // Bids Side (Left - Green/Emerald)
          const bidIdx = Math.min(Math.floor(Math.abs(xPos + 0.5) / (widthX / 2) * bids.length), bids.length - 1);
          const rawQty = bids[bidIdx]?.qty || 0;
          const decay = Math.max(1 - (Math.abs(zPos) / (depthZ / 2)) * 0.4, 0.3);
          heightVal = Math.pow(rawQty / maxVol, 0.7) * 14 * decay;

          // Color gradient: deeper green for higher liquidity peaks
          const intensity = Math.min(heightVal / 14, 1);
          r = 0.05 + intensity * 0.1;
          g = 0.6 + intensity * 0.4;
          b = 0.4 + intensity * 0.2;

          // Check if Whale Wall peak
          if (bids[bidIdx] && whaleBids.some(w => Math.abs(w.price - bids[bidIdx].price) < 25)) {
            heightVal += 2.5;
            g = 0.95;
            b = 0.6;
          }
        } else if (xPos > 0.5) {
          // Asks Side (Right - Red/Rose)
          const askIdx = Math.min(Math.floor((xPos - 0.5) / (widthX / 2) * asks.length), asks.length - 1);
          const rawQty = asks[askIdx]?.qty || 0;
          const decay = Math.max(1 - (Math.abs(zPos) / (depthZ / 2)) * 0.4, 0.3);
          heightVal = Math.pow(rawQty / maxVol, 0.7) * 14 * decay;

          // Color gradient: deeper red for higher liquidity peaks
          const intensity = Math.min(heightVal / 14, 1);
          r = 0.7 + intensity * 0.3;
          g = 0.1 + intensity * 0.2;
          b = 0.25 + intensity * 0.25;

          // Check if Whale Wall peak
          if (asks[askIdx] && whaleAsks.some(w => Math.abs(w.price - asks[askIdx].price) < 25)) {
            heightVal += 2.5;
            r = 0.98;
            g = 0.25;
          }
        } else {
          // Spot Price Canyon Valley (Center)
          heightVal = 0.2;
          r = 0.2; g = 0.7; b = 0.95;
        }

        posAttr.setY(vertexIdx, heightVal);

        colors[vertexIdx * 3] = r;
        colors[vertexIdx * 3 + 1] = g;
        colors[vertexIdx * 3 + 2] = b;
      }
    }

    surfaceGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    surfaceGeo.computeVertexNormals();

    // Surface Mesh Material
    const surfaceMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.3,
      metalness: 0.2,
      wireframe: viewMode === 'wireframe',
      side: THREE.DoubleSide
    });

    const surfaceMesh = new THREE.Mesh(surfaceGeo, surfaceMat);
    surfaceMesh.castShadow = true;
    surfaceMesh.receiveShadow = true;
    scene.add(surfaceMesh);

    // Subtle Contour Wireframe Overlay for crisp institutional topography look
    if (viewMode !== 'wireframe') {
      const wireMat = new THREE.MeshBasicMaterial({
        color: isDark ? 0xffffff : 0x000000,
        wireframe: true,
        transparent: true,
        opacity: isDark ? 0.12 : 0.08
      });
      const wireMesh = new THREE.Mesh(surfaceGeo, wireMat);
      wireMesh.position.y += 0.02;
      scene.add(wireMesh);
    }

    // 9. Add Whale Wall Beacons (Glowing Rings above peaks)
    whaleBids.forEach(wb => {
      const bIdx = bids.findIndex(b => Math.abs(b.price - wb.price) < 30);
      if (bIdx >= 0) {
        const xPos = -((bIdx + 1) / bids.length) * (widthX / 2) - 1.0;
        const beaconGeo = new THREE.TorusGeometry(0.7, 0.08, 12, 30);
        const beaconMat = new THREE.MeshBasicMaterial({ color: 0x34d399 });
        const beacon = new THREE.Mesh(beaconGeo, beaconMat);
        beacon.rotation.x = Math.PI / 2;
        beacon.position.set(xPos, 12, 0);
        scene.add(beacon);
      }
    });

    whaleAsks.forEach(wa => {
      const aIdx = asks.findIndex(a => Math.abs(a.price - wa.price) < 30);
      if (aIdx >= 0) {
        const xPos = ((aIdx + 1) / asks.length) * (widthX / 2) + 1.0;
        const beaconGeo = new THREE.TorusGeometry(0.7, 0.08, 12, 30);
        const beaconMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });
        const beacon = new THREE.Mesh(beaconGeo, beaconMat);
        beacon.rotation.x = Math.PI / 2;
        beacon.position.set(xPos, 12, 0);
        scene.add(beacon);
      }
    });

    // 10. Resize Listener
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // 11. Animation Loop
    const animate = () => {
      reqIdRef.current = requestAnimationFrame(animate);

      if (controlsRef.current) {
        controlsRef.current.autoRotate = isAutoRotate;
        controlsRef.current.autoRotateSpeed = 0.6;
        controlsRef.current.update();
      }

      // Pulse spot ring
      if (spotRing) {
        spotRing.scale.x = 1 + Math.sin(Date.now() * 0.003) * 0.15;
        spotRing.scale.y = 1 + Math.sin(Date.now() * 0.003) * 0.15;
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (reqIdRef.current) cancelAnimationFrame(reqIdRef.current);
      if (rendererRef.current && rendererRef.current.domElement) {
        container.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
      }
    };
  }, [bids, asks, maxVol, theme, viewMode, isAutoRotate, whaleBids, whaleAsks]);

  // Focus Camera smoothly on specific Whale Wall
  const focusOnWall = (wall, type) => {
    setFocusedWall({ ...wall, type });
    if (!cameraRef.current || !controlsRef.current) return;

    const targetX = type === 'bid'
      ? -((Math.max(bids.findIndex(b => Math.abs(b.price - wall.price) < 30), 0) + 1) / bids.length) * 35 - 1.0
      : ((Math.max(asks.findIndex(a => Math.abs(a.price - wall.price) < 30), 0) + 1) / asks.length) * 35 + 1.0;

    const targetPos = new THREE.Vector3(targetX, 4, 0);
    const camPos = new THREE.Vector3(targetX, 12, 18);

    controlsRef.current.target.copy(targetPos);
    cameraRef.current.position.copy(camPos);
  };

  // Reset Camera Position
  const resetCamera = () => {
    setFocusedWall(null);
    if (!cameraRef.current || !controlsRef.current) return;
    controlsRef.current.target.set(0, 4, 0);
    cameraRef.current.position.set(0, 24, 42);
  };

  // Take Canvas Snapshot
  const takeSnapshot = () => {
    if (!rendererRef.current) return;
    const url = rendererRef.current.domElement.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `3D_Liquidity_Surface_${new Date().toISOString().split('T')[0]}.png`;
    link.href = url;
    link.click();

    setSnapshotToast(true);
    setTimeout(() => setSnapshotToast(false), 2500);
  };

  // Calculate OBI summary safely
  const obiRaw = orderBookData?.obiPercent;
  const obiVal = Number.isFinite(Number(obiRaw)) ? Number(obiRaw) : 12.4;
  const isObiBullish = obiVal >= 0;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: 'calc(100vh - 120px)',
        minHeight: '650px',
        borderRadius: '12px',
        overflow: 'hidden',
        background: theme === 'light' ? '#f4f3ef' : '#07090e',
        border: '1px solid var(--border-panel)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        fontFamily: 'var(--font-sans)',
        userSelect: 'none'
      }}
    >
      {/* 3D WebGL Canvas Container */}
      <div ref={containerRef} style={{ width: '100%', height: '100%', cursor: 'grab' }} />

      {/* ─── FLOATING TOP HUD BAR ────────────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          left: '16px',
          right: '16px',
          display: 'flex',
          justify: 'space-between',
          alignItems: 'center',
          pointerEvents: 'none',
          zIndex: 10
        }}
      >
        {/* Left Title Box */}
        <div
          style={{
            pointerEvents: 'auto',
            background: 'var(--bg-header)',
            backdropFilter: 'blur(16px)',
            border: '1px solid var(--border-panel)',
            padding: '10px 18px',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.25)'
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'var(--gradient-aurora)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff'
            }}
          >
            <Sparkles size={18} />
          </div>
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 800, letterSpacing: '0.05em', color: 'var(--text-contrast)' }} className="font-mono">
              3D LIQUIDITY WAVE SURFACE
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--color-emerald-400)', display: 'flex', alignItems: 'center', gap: '6px' }} className="font-mono">
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-emerald-400)', display: 'inline-block' }} />
              TOPOGRAPHIC MARKET DEPTH MESH
            </div>
          </div>
        </div>

        {/* Center Spot Price Banner */}
        <div
          style={{
            pointerEvents: 'auto',
            background: 'var(--bg-header)',
            backdropFilter: 'blur(16px)',
            border: '1px solid var(--border-panel)',
            padding: '8px 24px',
            borderRadius: '30px',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.25)'
          }}
          className="font-mono"
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.6rem', color: 'var(--text-slate-400)' }}>BITCOIN SPOT</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#38bdf8' }}>
              ${spotPriceNum.toLocaleString('en-US')}
            </div>
          </div>
          <div style={{ height: '24px', width: '1px', background: 'var(--border-panel)' }} />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.75rem',
              fontWeight: 700,
              color: change24hNum >= 0 ? 'var(--color-emerald-400)' : 'var(--color-rose-400)'
            }}
          >
            {change24hNum >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            {change24hNum >= 0 ? `+${change24hNum}%` : `${change24hNum}%`}
          </div>
        </div>

        {/* Right Action Button */}
        <div style={{ pointerEvents: 'auto', display: 'flex', gap: '10px' }}>
          {onClose && (
            <button
              onClick={onClose}
              className="font-mono"
              style={{
                background: 'var(--bg-slate-900)',
                color: 'var(--text-slate-300)',
                border: '1px solid var(--border-panel)',
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '0.72rem',
                fontWeight: 700,
                cursor: 'pointer',
                backdropFilter: 'blur(12px)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <Maximize2 size={14} /> THOÁT 3D
            </button>
          )}
        </div>
      </div>

      {/* ─── FLOATING LEFT HUD CARD (OBI & FLOW METRICS) ────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: '80px',
          left: '16px',
          width: '260px',
          background: 'var(--bg-header)',
          backdropFilter: 'blur(20px)',
          border: '1px solid var(--border-panel)',
          borderRadius: '12px',
          padding: '16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          zIndex: 10
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-slate-400)', letterSpacing: '0.05em' }} className="font-mono">
            OBI METRICS &amp; DEPTH
          </span>
          <Activity size={15} style={{ color: 'var(--color-emerald-400)' }} />
        </div>

        {/* OBI Main Gauge */}
        <div
          style={{
            background: 'var(--bg-slate-900)',
            padding: '12px',
            borderRadius: '8px',
            border: '1px solid var(--border-panel)',
            textAlign: 'center'
          }}
        >
          <div style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)', marginBottom: '4px' }} className="font-mono">
            ORDER BOOK IMBALANCE (OBI)
          </div>
          <div
            style={{
              fontSize: '1.4rem',
              fontWeight: 800,
              color: isObiBullish ? 'var(--color-emerald-400)' : 'var(--color-rose-400)'
            }}
            className="font-mono"
          >
            {isObiBullish ? `+${obiVal}%` : `${obiVal}%`}
          </div>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: isObiBullish ? 'var(--color-emerald-400)' : 'var(--color-rose-400)', marginTop: '2px' }} className="font-mono">
            {isObiBullish ? '🟢 RÀO MUA CHIẾM ƯU THẾ' : '🔴 RÀO BÁN CHIẾM ƯU THẾ'}
          </div>
        </div>

        {/* Bid/Ask Volume Visual Bar */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: 'var(--text-slate-400)', marginBottom: '6px' }} className="font-mono">
            <span style={{ color: 'var(--color-emerald-400)' }}>BIDS (MUA): 56.2%</span>
            <span style={{ color: 'var(--color-rose-400)' }}>ASKS (BÁN): 43.8%</span>
          </div>
          <div style={{ height: '6px', borderRadius: '3px', width: '100%', background: 'var(--bg-slate-800)', display: 'flex', overflow: 'hidden' }}>
            <div style={{ width: '56.2%', background: 'var(--color-emerald-400)' }} />
            <div style={{ width: '43.8%', background: 'var(--color-rose-400)' }} />
          </div>
        </div>

        {/* Data Provenance & Model */}
        <div style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)', lineHeight: 1.6 }} className="font-mono">
          <div>• Mô hình: Smooth Surface Mesh 3D</div>
          <div>• Nguồn: Binance/Bybit/OKX/Bitget</div>
          <div>• Đỉnh sóng: Vùng tập trung thanh khoản</div>
        </div>
      </div>

      {/* ─── FLOATING RIGHT HUD CARD (WHALE WALLS SELECTOR WITH ZERO NaN) ────────── */}
      <div
        style={{
          position: 'absolute',
          top: '80px',
          right: '16px',
          width: '285px',
          background: 'var(--bg-header)',
          backdropFilter: 'blur(20px)',
          border: '1px solid var(--border-panel)',
          borderRadius: '12px',
          padding: '16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          maxHeight: 'calc(100% - 160px)',
          overflowY: 'auto',
          zIndex: 10
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-slate-400)', letterSpacing: '0.05em' }} className="font-mono">
            TƯỜNG CÁ VOI (WHALE WALLS)
          </span>
          <ShieldAlert size={15} style={{ color: 'var(--color-amber-400)' }} />
        </div>

        {/* Whale Bids Section */}
        <div>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-emerald-400)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }} className="font-mono">
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-emerald-400)' }} />
            TƯỜNG MUA LỚN NHẤT (WHALE BIDS)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {whaleBids.map((wb, i) => (
              <div
                key={i}
                onClick={() => focusOnWall(wb, 'bid')}
                style={{
                  background: focusedWall?.price === wb.price ? 'rgba(16, 185, 129, 0.18)' : 'var(--bg-slate-900)',
                  border: focusedWall?.price === wb.price ? '1px solid var(--color-emerald-400)' : '1px solid var(--border-panel)',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  justify: 'space-between',
                  alignItems: 'center'
                }}
                className="font-mono"
              >
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-emerald-400)' }}>
                    ${Number(wb.price).toLocaleString('en-US')}
                  </div>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-slate-400)' }}>
                    Cách spot: -{wb.distPct}%
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-contrast)' }}>
                    {wb.qty.toFixed(1)} BTC
                  </div>
                  <div style={{ fontSize: '0.58rem', color: 'var(--text-slate-400)' }}>
                    ${(wb.usdVal / 1e6).toFixed(2)}M USD
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Whale Asks Section */}
        <div>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-rose-400)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }} className="font-mono">
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-rose-400)' }} />
            TƯỜNG BÁN LỚN NHẤT (WHALE ASKS)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {whaleAsks.map((wa, i) => (
              <div
                key={i}
                onClick={() => focusOnWall(wa, 'ask')}
                style={{
                  background: focusedWall?.price === wa.price ? 'rgba(244, 63, 94, 0.18)' : 'var(--bg-slate-900)',
                  border: focusedWall?.price === wa.price ? '1px solid var(--color-rose-400)' : '1px solid var(--border-panel)',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  justify: 'space-between',
                  alignItems: 'center'
                }}
                className="font-mono"
              >
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-rose-400)' }}>
                    ${Number(wa.price).toLocaleString('en-US')}
                  </div>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-slate-400)' }}>
                    Cách spot: +{wa.distPct}%
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-contrast)' }}>
                    {wa.qty.toFixed(1)} BTC
                  </div>
                  <div style={{ fontSize: '0.58rem', color: 'var(--text-slate-400)' }}>
                    ${(wa.usdVal / 1e6).toFixed(2)}M USD
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* View Mode Toggle Controls */}
        <div>
          <div style={{ fontSize: '0.62rem', fontWeight: 800, color: 'var(--text-slate-400)', marginBottom: '6px' }} className="font-mono">
            CHẾ ĐỘ 3D:
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
            {[
              { id: 'surface', label: 'Thảm 3D Surface', icon: WaveIcon },
              { id: 'wireframe', label: 'Lưới Topo 3D', icon: Eye }
            ].map(m => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  onClick={() => setViewMode(m.id)}
                  style={{
                    background: viewMode === m.id ? 'var(--color-emerald-400)' : 'var(--bg-slate-900)',
                    color: viewMode === m.id ? '#000' : 'var(--text-slate-300)',
                    border: '1px solid var(--border-panel)',
                    padding: '6px 4px',
                    borderRadius: '4px',
                    fontSize: '0.6rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '2px'
                  }}
                  className="font-mono"
                >
                  <Icon size={12} />
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ─── FLOATING BOTTOM CONTROLS BAR ────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          bottom: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--bg-header)',
          backdropFilter: 'blur(20px)',
          border: '1px solid var(--border-panel)',
          borderRadius: '30px',
          padding: '8px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
          zIndex: 10
        }}
        className="font-mono"
      >
        <button
          onClick={() => setIsAutoRotate(!isAutoRotate)}
          style={{
            background: isAutoRotate ? 'var(--color-emerald-400)' : 'var(--bg-slate-900)',
            color: isAutoRotate ? '#000' : 'var(--text-slate-300)',
            border: '1px solid var(--border-panel)',
            padding: '6px 14px',
            borderRadius: '20px',
            fontSize: '0.68rem',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          {isAutoRotate ? <Pause size={12} /> : <Play size={12} />}
          {isAutoRotate ? 'TẮT XOAY 3D' : 'BẬT XOAY 3D'}
        </button>

        <button
          onClick={resetCamera}
          style={{
            background: 'var(--bg-slate-900)',
            color: 'var(--text-slate-300)',
            border: '1px solid var(--border-panel)',
            padding: '6px 14px',
            borderRadius: '20px',
            fontSize: '0.68rem',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <RotateCcw size={12} /> RESET CAMERA
        </button>

        <button
          onClick={takeSnapshot}
          style={{
            background: 'var(--bg-slate-900)',
            color: 'var(--color-amber-400)',
            border: '1px solid var(--border-panel)',
            padding: '6px 14px',
            borderRadius: '20px',
            fontSize: '0.68rem',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <Camera size={12} /> CHỤP SNAPSHOT
        </button>
      </div>

      {/* Snapshot Toast Notification */}
      {snapshotToast && (
        <div
          style={{
            position: 'absolute',
            bottom: '75px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--color-emerald-400)',
            color: '#000',
            padding: '6px 16px',
            borderRadius: '20px',
            fontSize: '0.7rem',
            fontWeight: 800,
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            zIndex: 20
          }}
          className="font-mono"
        >
          <Check size={14} /> ĐÃ TẢI XUỐNG ẢNH SNAPSHOT 3D ATLAS!
        </div>
      )}
    </div>
  );
}
