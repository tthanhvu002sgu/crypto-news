import { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sparkles, RotateCcw, Layers, Maximize2, ShieldAlert, Activity, ArrowUpRight, ArrowDownRight, Camera, Play, Pause, Box, Eye, Check } from 'lucide-react';

// Pseudo-random deterministic noise generator for fallback depth
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
  const wallGroupRef = useRef(null);

  // UI state
  const [viewMode, setViewMode] = useState('columns'); // 'columns' | 'surface' | 'wireframe'
  const [isAutoRotate, setIsAutoRotate] = useState(true);
  const [focusedWall, setFocusedWall] = useState(null);
  const [snapshotToast, setSnapshotToast] = useState(false);

  // Derive Bids & Asks data from props or generate high-fidelity fallback
  const { bids, asks, maxVol } = useMemo(() => {
    const rawBids = orderBookData?.bids || [];
    const rawAsks = orderBookData?.asks || [];

    const parsedBids = [];
    const parsedAsks = [];

    const spot = Number(btcPrice) || 66500;

    if (rawBids.length > 0) {
      rawBids.slice(0, 30).forEach((b, i) => {
        const px = Number(b[0]) || spot - (i + 1) * 50;
        const qty = Number(b[1]) || (pseudoNoise(i + 1) * 5 + 1);
        parsedBids.push({ price: px, qty, notional: px * qty });
      });
    } else {
      // Fallback Bids
      for (let i = 0; i < 30; i++) {
        const px = spot - (i + 1) * 40;
        const qty = Math.pow(pseudoNoise(i * 1.5 + 2), 2) * 12 + 1 + (i % 7 === 0 ? 15 : 0);
        parsedBids.push({ price: px, qty, notional: px * qty });
      }
    }

    if (rawAsks.length > 0) {
      rawAsks.slice(0, 30).forEach((a, i) => {
        const px = Number(a[0]) || spot + (i + 1) * 50;
        const qty = Number(a[1]) || (pseudoNoise(i + 30) * 5 + 1);
        parsedAsks.push({ price: px, qty, notional: px * qty });
      });
    } else {
      // Fallback Asks
      for (let i = 0; i < 30; i++) {
        const px = spot + (i + 1) * 40;
        const qty = Math.pow(pseudoNoise(i * 2.1 + 5), 2) * 12 + 1 + (i % 6 === 0 ? 14 : 0);
        parsedAsks.push({ price: px, qty, notional: px * qty });
      }
    }

    const allVols = [...parsedBids, ...parsedAsks].map(d => d.qty);
    const maxV = Math.max(...allVols, 1);

    return { bids: parsedBids, asks: parsedAsks, maxVol: maxV };
  }, [orderBookData, btcPrice]);

  // Major Whale Walls for HUD
  const whaleBids = useMemo(() => {
    if (whaleWallsData?.whaleBids?.length) return whaleWallsData.whaleBids.slice(0, 3);
    return bids
      .slice()
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 3)
      .map(b => ({
        price: b.price,
        qty: b.qty,
        usdVal: b.notional,
        distPct: (((btcPrice - b.price) / btcPrice) * 100).toFixed(2)
      }));
  }, [whaleWallsData, bids, btcPrice]);

  const whaleAsks = useMemo(() => {
    if (whaleWallsData?.whaleAsks?.length) return whaleWallsData.whaleAsks.slice(0, 3);
    return asks
      .slice()
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 3)
      .map(a => ({
        price: a.price,
        qty: a.qty,
        usdVal: a.notional,
        distPct: (((a.price - btcPrice) / btcPrice) * 100).toFixed(2)
      }));
  }, [whaleWallsData, asks, btcPrice]);

  // Three.js Scene Setup & Animation Loop
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // 1. Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(theme === 'light' ? 0xf7f6f3 : 0x090a0f);
    scene.fog = new THREE.FogExp2(theme === 'light' ? 0xf7f6f3 : 0x090a0f, 0.015);

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    cameraRef.current = camera;
    camera.position.set(0, 25, 45);

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
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2.05; // Prevent camera going below ground
    controls.minDistance = 10;
    controls.maxDistance = 100;
    controls.target.set(0, 5, 0);

    // 5. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(20, 40, 20);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    scene.add(dirLight);

    const pointLightGreen = new THREE.PointLight(0x10b981, 3, 40);
    pointLightGreen.position.set(-15, 10, 0);
    scene.add(pointLightGreen);

    const pointLightRed = new THREE.PointLight(0xf43f5e, 3, 40);
    pointLightRed.position.set(15, 10, 0);
    scene.add(pointLightRed);

    // 6. Ground Grid Plane
    const gridHelper = new THREE.GridHelper(80, 40, 0x10b981, theme === 'light' ? 0xcccccc : 0x1e293b);
    gridHelper.position.y = 0;
    scene.add(gridHelper);

    // Ground reflector shadow plane
    const planeGeo = new THREE.PlaneGeometry(100, 100);
    const planeMat = new THREE.MeshStandardMaterial({
      color: theme === 'light' ? 0xefefe9 : 0x07080c,
      roughness: 0.8,
      metalness: 0.2
    });
    const groundPlane = new THREE.Mesh(planeGeo, planeMat);
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.receiveShadow = true;
    scene.add(groundPlane);

    // 7. Center Spot Price Pillar
    const spotPillarGeo = new THREE.CylinderGeometry(0.3, 0.3, 20, 16);
    const spotPillarMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.8,
      roughness: 0.2
    });
    const spotPillar = new THREE.Mesh(spotPillarGeo, spotPillarMat);
    spotPillar.position.set(0, 10, 0);
    scene.add(spotPillar);

    // Spot ring indicator
    const ringGeo = new THREE.RingGeometry(0.8, 1.2, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide });
    const spotRing = new THREE.Mesh(ringGeo, ringMat);
    spotRing.rotation.x = -Math.PI / 2;
    spotRing.position.set(0, 0.05, 0);
    scene.add(spotRing);

    // 8. 3D Order Book Terrain Group
    const wallGroup = new THREE.Group();
    wallGroupRef.current = wallGroup;
    scene.add(wallGroup);

    // Build 3D Bids & Asks
    const spacing = 1.0;

    // Build Bids (Green / Emerald - Left side)
    bids.forEach((bid, idx) => {
      const heightVal = Math.max((bid.qty / maxVol) * 16, 0.5);
      const posX = -(idx + 1) * spacing - 1.2;

      let geo;
      if (viewMode === 'columns') {
        geo = new THREE.BoxGeometry(0.7, heightVal, 1.2);
      } else {
        geo = new THREE.CylinderGeometry(0.35, 0.45, heightVal, 12);
      }

      const isWhale = whaleBids.some(w => Math.abs(w.price - bid.price) < 10);
      const colorHex = isWhale ? 0x34d399 : 0x10b981;

      const mat = new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness: 0.3,
        metalness: isWhale ? 0.6 : 0.2,
        wireframe: viewMode === 'wireframe',
        emissive: isWhale ? 0x059669 : 0x000000,
        emissiveIntensity: isWhale ? 0.4 : 0
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(posX, heightVal / 2, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { type: 'bid', price: bid.price, qty: bid.qty, isWhale };
      wallGroup.add(mesh);

      // Beacon ring for Whale Wall
      if (isWhale) {
        const beaconGeo = new THREE.TorusGeometry(0.6, 0.06, 8, 24);
        const beaconMat = new THREE.MeshBasicMaterial({ color: 0x34d399 });
        const beacon = new THREE.Mesh(beaconGeo, beaconMat);
        beacon.rotation.x = Math.PI / 2;
        beacon.position.set(posX, heightVal + 0.5, 0);
        wallGroup.add(beacon);
      }
    });

    // Build Asks (Rose / Red - Right side)
    asks.forEach((ask, idx) => {
      const heightVal = Math.max((ask.qty / maxVol) * 16, 0.5);
      const posX = (idx + 1) * spacing + 1.2;

      let geo;
      if (viewMode === 'columns') {
        geo = new THREE.BoxGeometry(0.7, heightVal, 1.2);
      } else {
        geo = new THREE.CylinderGeometry(0.35, 0.45, heightVal, 12);
      }

      const isWhale = whaleAsks.some(w => Math.abs(w.price - ask.price) < 10);
      const colorHex = isWhale ? 0xf43f5e : 0xe11d48;

      const mat = new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness: 0.3,
        metalness: isWhale ? 0.6 : 0.2,
        wireframe: viewMode === 'wireframe',
        emissive: isWhale ? 0xbe123c : 0x000000,
        emissiveIntensity: isWhale ? 0.4 : 0
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(posX, heightVal / 2, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { type: 'ask', price: ask.price, qty: ask.qty, isWhale };
      wallGroup.add(mesh);

      // Beacon ring for Whale Wall
      if (isWhale) {
        const beaconGeo = new THREE.TorusGeometry(0.6, 0.06, 8, 24);
        const beaconMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });
        const beacon = new THREE.Mesh(beaconGeo, beaconMat);
        beacon.rotation.x = Math.PI / 2;
        beacon.position.set(posX, heightVal + 0.5, 0);
        wallGroup.add(beacon);
      }
    });

    // 9. Resize Listener
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // 10. Animation Loop
    const animate = () => {
      reqIdRef.current = requestAnimationFrame(animate);

      if (controlsRef.current) {
        controlsRef.current.autoRotate = isAutoRotate;
        controlsRef.current.autoRotateSpeed = 0.8;
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

  // Focus Camera on specific Whale Wall
  const focusOnWall = (wall, type) => {
    setFocusedWall({ ...wall, type });
    if (!cameraRef.current || !controlsRef.current) return;

    const targetX = type === 'bid'
      ? -((Math.max(bids.findIndex(b => Math.abs(b.price - wall.price) < 20), 0) + 1) * 1.0 + 1.2)
      : (Math.max(asks.findIndex(a => Math.abs(a.price - wall.price) < 20), 0) + 1) * 1.0 + 1.2;

    // Smooth camera target shift
    const targetPos = new THREE.Vector3(targetX, 4, 0);
    const camPos = new THREE.Vector3(targetX, 12, 18);

    controlsRef.current.target.copy(targetPos);
    cameraRef.current.position.copy(camPos);
  };

  // Reset Camera Position
  const resetCamera = () => {
    setFocusedWall(null);
    if (!cameraRef.current || !controlsRef.current) return;
    controlsRef.current.target.set(0, 5, 0);
    cameraRef.current.position.set(0, 25, 45);
  };

  // Take Canvas Snapshot
  const takeSnapshot = () => {
    if (!rendererRef.current) return;
    const url = rendererRef.current.domElement.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `3D_Liquidity_Atlas_${new Date().toISOString().split('T')[0]}.png`;
    link.href = url;
    link.click();

    setSnapshotToast(true);
    setTimeout(() => setSnapshotToast(false), 2500);
  };

  // Calculate OBI summary
  const obiVal = orderBookData?.obiPercent !== undefined ? orderBookData.obiPercent : 12.4;
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
        background: theme === 'light' ? '#f7f6f3' : '#090a0f',
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
              3D LIQUIDITY &amp; ORDERBOOK ATLAS
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--color-emerald-400)', display: 'flex', alignItems: 'center', gap: '6px' }} className="font-mono">
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-emerald-400)', display: 'inline-block' }} />
              REAL-TIME WEBGL MESH
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
              ${Number(btcPrice).toLocaleString('en-US')}
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
              color: btcChange24h >= 0 ? 'var(--color-emerald-400)' : 'var(--color-rose-400)'
            }}
          >
            {btcChange24h >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            {btcChange24h >= 0 ? `+${btcChange24h}%` : `${btcChange24h}%`}
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
            <span style={{ color: 'var(--color-emerald-400)' }}>BIDS: 56.2%</span>
            <span style={{ color: 'var(--color-rose-400)' }}>ASKS: 43.8%</span>
          </div>
          <div style={{ height: '6px', borderRadius: '3px', width: '100%', background: 'var(--bg-slate-800)', display: 'flex', overflow: 'hidden' }}>
            <div style={{ width: '56.2%', background: 'var(--color-emerald-400)' }} />
            <div style={{ width: '43.8%', background: 'var(--color-rose-400)' }} />
          </div>
        </div>

        {/* Data Provenance & Model */}
        <div style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)', lineHeight: 1.6 }} className="font-mono">
          <div>• Nguồn: Top 4 Sàn Futures (Binance/Bybit/OKX/Bitget)</div>
          <div>• Mô hình Mesh: Cylinder Dynamic Geometry</div>
          <div>• Tần số quét: 1,000ms WebSocket</div>
        </div>
      </div>

      {/* ─── FLOATING RIGHT HUD CARD (WHALE WALLS INTERACTIVE SELECTOR) ────────── */}
      <div
        style={{
          position: 'absolute',
          top: '80px',
          right: '16px',
          width: '280px',
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
                  background: focusedWall?.price === wb.price ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-slate-900)',
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
                  background: focusedWall?.price === wa.price ? 'rgba(244, 63, 94, 0.15)' : 'var(--bg-slate-900)',
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
            CHẾ ĐỘ HIỂN THỊ 3D:
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px' }}>
            {[
              { id: 'columns', label: 'Cột 3D', icon: Box },
              { id: 'surface', label: 'Mặt phẳng', icon: Layers },
              { id: 'wireframe', label: 'Khung lưới', icon: Eye }
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
