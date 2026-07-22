import { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sparkles, RotateCcw, ShieldAlert, Camera, Play, Pause, Box, Eye, Check, Layers, Cpu, Globe, Zap, Compass, Award } from 'lucide-react';

export default function Specimen3DAtlasTab({
  data = {},
  btcDisplay = {},
  fund = null,
  theme = 'dark'
}) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const reqIdRef = useRef(null);
  const crystalMeshGroupRef = useRef(null);
  const coreMeshRef = useRef(null);

  // Selected Asset Specimen
  const [selectedAsset, setSelectedAsset] = useState('BTC'); // 'BTC' | 'ETH' | 'SOL'
  const [viewStyle, setViewStyle] = useState('solid'); // 'solid' | 'wireframe' | 'exploded'
  const [isAutoRotate, setIsAutoRotate] = useState(true);
  const [snapshotToast, setSnapshotToast] = useState(false);
  const [activeFacet, setActiveFacet] = useState(null);

  // Asset Metrics Normalization
  const assetSpecs = useMemo(() => {
    const spotBtc = Number(btcDisplay?.price || data?.btc?.price || 66500);
    const changeBtc = Number(btcDisplay?.change || data?.btc?.changePercent || 2.5);

    const spotEth = Number(data?.eth?.price || 3450);
    const changeEth = Number(data?.eth?.changePercent || 1.8);

    const spotSol = Number(data?.sol?.price || 185);
    const changeSol = Number(data?.sol?.changePercent || 4.2);

    if (selectedAsset === 'ETH') {
      const mvrv = Number(data?.ethOnChainMetrics?.mvrv || 1.85);
      const score = Math.min(Math.max((mvrv / 3.0) * 10, 1), 10);
      return {
        symbol: 'ETH',
        name: 'ETHEREUM SPECIMEN',
        serial: '#002-ETH',
        price: spotEth,
        change24h: changeEth,
        score: score.toFixed(1),
        scoreLabel: score >= 7 ? 'BULLISH EXPANSION' : score >= 4.5 ? 'ACCUMULATION' : 'DISTRIBUTION RISK',
        colorHex: 0x6366f1,
        colorCss: '#6366f1',
        macroRegime: data?.fedFundsRate > 4.0 ? 'RESTRICTIVE' : 'ACCOMMODATIVE',
        productionCost: 'N/A (PoS Network)',
        mvrv: mvrv.toFixed(2),
        nupl: (data?.ethOnChainMetrics?.nupl || 0.42).toFixed(2),
        supplyInProfit: '78.5%',
        etfFlow7d: '+$142M USD',
        fundingRate: fund != null ? `${(fund * 100).toFixed(4)}%` : '+0.0100%',
        openInterest: '$12.4B USD',
        lsRatio: '1.45 (Long Bias)',
        dominance: `${data?.globalData?.ethDominance || '17.2'}%`,
        activeAddresses: '485,000 / day',
        era: 'PoS Staking Era'
      };
    }

    if (selectedAsset === 'SOL') {
      return {
        symbol: 'SOL',
        name: 'SOLANA SPECIMEN',
        serial: '#003-SOL',
        price: spotSol,
        change24h: changeSol,
        score: '7.8',
        scoreLabel: 'HIGH MOMENTUM',
        colorHex: 0x14f195,
        colorCss: '#14f195',
        macroRegime: data?.fedFundsRate > 4.0 ? 'RESTRICTIVE' : 'ACCOMMODATIVE',
        productionCost: 'N/A (High TPS PoH)',
        mvrv: '2.45',
        nupl: '0.58',
        supplyInProfit: '84.2%',
        etfFlow7d: '+$38M USD (ETP)',
        fundingRate: '+0.0150%',
        openInterest: '$3.8B USD',
        lsRatio: '1.62 (Long Bias)',
        dominance: '3.8%',
        activeAddresses: '1,250,000 / day',
        era: 'High Speed Monolithic'
      };
    }

    // Default BTC Specimen
    const mvrv = Number(data?.onChainMetrics?.mvrv || 2.15);
    const score = Math.min(Math.max((mvrv / 3.5) * 10, 1), 10);
    return {
      symbol: 'BTC',
      name: 'BITCOIN SPECIMEN',
      serial: '#001-BTC',
      price: spotBtc,
      change24h: changeBtc,
      score: score.toFixed(1),
      scoreLabel: score >= 7 ? 'BULLISH EXPANSION' : score >= 4.5 ? 'ACCUMULATION' : 'DISTRIBUTION RISK',
      colorHex: score >= 7 ? 0x10b981 : score >= 4.5 ? 0xf59e0b : 0xf43f5e,
      colorCss: score >= 7 ? '#10b981' : score >= 4.5 ? '#f59e0b' : '#f43f5e',
      macroRegime: data?.fedFundsRate > 4.0 ? 'RESTRICTIVE' : 'ACCOMMODATIVE',
      productionCost: '$58,500 - $64,200',
      mvrv: mvrv.toFixed(2),
      nupl: (data?.onChainMetrics?.nupl || 0.52).toFixed(2),
      supplyInProfit: '86.4%',
      etfFlow7d: '+$645M USD',
      fundingRate: fund != null ? `${(fund * 100).toFixed(4)}%` : '+0.0100%',
      openInterest: '$36.2B USD',
      lsRatio: '1.28 (Balanced)',
      dominance: `${data?.globalData?.btcDominance || '56.4'}%`,
      activeAddresses: '920,000 / day',
      era: 'Post-2024 Halving Era'
    };
  }, [selectedAsset, btcDisplay, data, fund]);

  // Three.js 3D WebGL Crystal Specimen Engine
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // 1. Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const isDark = theme !== 'light';
    scene.background = new THREE.Color(isDark ? 0x06080d : 0xf5f4f0);
    scene.fog = new THREE.FogExp2(isDark ? 0x06080d : 0xf5f4f0, 0.012);

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 1000);
    cameraRef.current = camera;
    camera.position.set(0, 16, 36);

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
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.minDistance = 8;
    controls.maxDistance = 80;
    controls.target.set(0, 2, 0);

    // 5. Lighting Studio
    const ambientLight = new THREE.AmbientLight(0xffffff, isDark ? 0.8 : 1.2);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight1.position.set(20, 35, 20);
    dirLight1.castShadow = true;
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(assetSpecs.colorHex, 2.5);
    dirLight2.position.set(-20, -10, -20);
    scene.add(dirLight2);

    // 6. Ground Grid Base
    const gridHelper = new THREE.GridHelper(80, 40, assetSpecs.colorHex, isDark ? 0x1e293b : 0xcbcecf);
    gridHelper.position.y = -6;
    scene.add(gridHelper);

    // 7. 3D Crystal Specimen Geometry (Group)
    const crystalGroup = new THREE.Group();
    crystalMeshGroupRef.current = crystalGroup;
    scene.add(crystalGroup);

    // Inner Glowing Energy Core Sphere
    const coreGeo = new THREE.SphereGeometry(2.2, 32, 32);
    const coreMat = new THREE.MeshStandardMaterial({
      color: assetSpecs.colorHex,
      emissive: assetSpecs.colorHex,
      emissiveIntensity: 1.5,
      roughness: 0.1,
      metalness: 0.8
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.position.set(0, 2, 0);
    coreMeshRef.current = coreMesh;
    scene.add(coreMesh);

    // Outer Polyhedral Crystal Facet Layers (Icosahedron)
    const baseIcosa = new THREE.IcosahedronGeometry(6, 0);
    const count = baseIcosa.attributes.position.count;

    // Create 20 separate triangular face meshes for Exploded View capability
    const faceMaterial = new THREE.MeshStandardMaterial({
      color: assetSpecs.colorHex,
      roughness: 0.2,
      metalness: 0.6,
      wireframe: viewStyle === 'wireframe',
      transparent: true,
      opacity: viewStyle === 'wireframe' ? 0.9 : 0.75,
      emissive: assetSpecs.colorHex,
      emissiveIntensity: 0.3,
      side: THREE.DoubleSide
    });

    for (let i = 0; i < count; i += 3) {
      const triGeo = new THREE.BufferGeometry();
      const p1 = new THREE.Vector3().fromBufferAttribute(baseIcosa.attributes.position, i);
      const p2 = new THREE.Vector3().fromBufferAttribute(baseIcosa.attributes.position, i + 1);
      const p3 = new THREE.Vector3().fromBufferAttribute(baseIcosa.attributes.position, i + 2);

      const vertices = new Float32Array([
        p1.x, p1.y, p1.z,
        p2.x, p2.y, p2.z,
        p3.x, p3.y, p3.z
      ]);
      triGeo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      triGeo.computeVertexNormals();

      const faceMesh = new THREE.Mesh(triGeo, faceMaterial);
      faceMesh.position.set(0, 2, 0);

      // Compute face normal vector for exploded expansion
      const center = new THREE.Vector3().add(p1).add(p2).add(p3).divideScalar(3).normalize();
      faceMesh.userData = { normalDir: center, origPos: new THREE.Vector3(0, 2, 0) };

      if (viewStyle === 'exploded') {
        const offset = center.clone().multiplyScalar(3.2);
        faceMesh.position.add(offset);
      }

      crystalGroup.add(faceMesh);
    }

    // 8. Outer Orbital Rings
    const ring1Geo = new THREE.TorusGeometry(8.5, 0.08, 16, 100);
    const ring1Mat = new THREE.MeshBasicMaterial({ color: assetSpecs.colorHex, transparent: true, opacity: 0.6 });
    const ring1 = new THREE.Mesh(ring1Geo, ring1Mat);
    ring1.rotation.x = Math.PI / 3;
    ring1.position.set(0, 2, 0);
    scene.add(ring1);

    const ring2Geo = new THREE.TorusGeometry(10.5, 0.06, 16, 100);
    const ring2Mat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.5 });
    const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
    ring2.rotation.y = Math.PI / 4;
    ring2.position.set(0, 2, 0);
    scene.add(ring2);

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

      // Rotate orbital rings
      if (ring1) ring1.rotation.z += 0.005;
      if (ring2) ring2.rotation.x += 0.004;

      // Pulse inner core
      if (coreMeshRef.current) {
        const pulse = 1 + Math.sin(Date.now() * 0.004) * 0.12;
        coreMeshRef.current.scale.set(pulse, pulse, pulse);
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
  }, [assetSpecs, theme, viewStyle, isAutoRotate]);

  // Focus Camera smoothly on specific Pillar Facet
  const focusOnPillarFacet = (pillarName) => {
    setActiveFacet(pillarName);
    if (!cameraRef.current || !controlsRef.current) return;

    let targetPos = new THREE.Vector3(0, 2, 0);
    let camPos = new THREE.Vector3(0, 16, 36);

    if (pillarName === 'macro') camPos = new THREE.Vector3(-18, 12, 22);
    else if (pillarName === 'onchain') camPos = new THREE.Vector3(18, 12, 22);
    else if (pillarName === 'flows') camPos = new THREE.Vector3(-18, 16, -20);
    else if (pillarName === 'derivatives') camPos = new THREE.Vector3(18, 16, -20);

    controlsRef.current.target.copy(targetPos);
    cameraRef.current.position.copy(camPos);
  };

  // Reset Camera
  const resetCamera = () => {
    setActiveFacet(null);
    if (!cameraRef.current || !controlsRef.current) return;
    controlsRef.current.target.set(0, 2, 0);
    cameraRef.current.position.set(0, 16, 36);
  };

  // Take Snapshot
  const takeSnapshot = () => {
    if (!rendererRef.current) return;
    const url = rendererRef.current.domElement.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `${assetSpecs.symbol}_Specimen_Atlas_${new Date().toISOString().split('T')[0]}.png`;
    link.href = url;
    link.click();

    setSnapshotToast(true);
    setTimeout(() => setSnapshotToast(false), 2500);
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: 'calc(100vh - 120px)',
        minHeight: '680px',
        borderRadius: '12px',
        overflow: 'hidden',
        background: theme === 'light' ? '#f5f4f0' : '#06080d',
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
              background: `linear-gradient(135deg, ${assetSpecs.colorCss}, #38bdf8)`,
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
              3D ASSET SPECIMEN ATLAS
            </div>
            <div style={{ fontSize: '0.65rem', color: assetSpecs.colorCss, display: 'flex', alignItems: 'center', gap: '6px' }} className="font-mono">
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: assetSpecs.colorCss, display: 'inline-block' }} />
              {assetSpecs.serial} · {assetSpecs.name}
            </div>
          </div>
        </div>

        {/* Center Asset Switcher & Score */}
        <div
          style={{
            pointerEvents: 'auto',
            background: 'var(--bg-header)',
            backdropFilter: 'blur(16px)',
            border: '1px solid var(--border-panel)',
            padding: '6px 16px',
            borderRadius: '30px',
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.25)'
          }}
          className="font-mono"
        >
          {/* Asset Selector Tabs */}
          <div style={{ display: 'flex', gap: '4px' }}>
            {['BTC', 'ETH', 'SOL'].map(sym => (
              <button
                key={sym}
                onClick={() => setSelectedAsset(sym)}
                style={{
                  background: selectedAsset === sym ? assetSpecs.colorCss : 'var(--bg-slate-900)',
                  color: selectedAsset === sym ? '#000' : 'var(--text-slate-300)',
                  border: '1px solid var(--border-panel)',
                  padding: '4px 10px',
                  borderRadius: '16px',
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  cursor: 'pointer'
                }}
              >
                {sym}
              </button>
            ))}
          </div>

          <div style={{ height: '20px', width: '1px', background: 'var(--border-panel)' }} />

          {/* Spot Price */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#38bdf8' }}>
              ${assetSpecs.price.toLocaleString('en-US')}
            </div>
          </div>

          {/* Score Badge */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: `${assetSpecs.colorCss}20`,
              border: `1px solid ${assetSpecs.colorCss}50`,
              padding: '4px 10px',
              borderRadius: '20px',
              fontSize: '0.68rem',
              fontWeight: 800,
              color: assetSpecs.colorCss
            }}
          >
            <Award size={13} /> SCORE: {assetSpecs.score}/10 ({assetSpecs.scoreLabel})
          </div>
        </div>

        {/* Right Info */}
        <div style={{ pointerEvents: 'auto', display: 'flex', gap: '8px' }}>
          <div
            style={{
              background: 'var(--bg-header)',
              backdropFilter: 'blur(16px)',
              border: '1px solid var(--border-panel)',
              padding: '8px 14px',
              borderRadius: '8px',
              fontSize: '0.7rem',
              fontWeight: 700,
              color: 'var(--text-slate-300)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            className="font-mono"
          >
            <Compass size={14} style={{ color: assetSpecs.colorCss }} />
            {assetSpecs.era}
          </div>
        </div>
      </div>

      {/* ─── FLOATING LEFT HUD CARD (PILLAR 1: MACRO & PILLAR 2: ON-CHAIN) ────── */}
      <div
        style={{
          position: 'absolute',
          top: '80px',
          left: '16px',
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
        {/* Pillar 1: Macro & Real Rates */}
        <div
          onClick={() => focusOnPillarFacet('macro')}
          style={{
            background: activeFacet === 'macro' ? `${assetSpecs.colorCss}15` : 'var(--bg-slate-900)',
            border: activeFacet === 'macro' ? `1px solid ${assetSpecs.colorCss}` : '1px solid var(--border-panel)',
            padding: '10px 12px',
            borderRadius: '8px',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-slate-400)', letterSpacing: '0.05em' }} className="font-mono">
              PILLAR 1: THANH KHOẢN VĨ MÔ
            </span>
            <Globe size={14} style={{ color: '#6366f1' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '0.65rem' }} className="font-mono">
            <div>
              <div style={{ color: 'var(--text-slate-400)' }}>Fed Rate:</div>
              <div style={{ fontWeight: 700, color: 'var(--text-contrast)' }}>{data?.fedFundsRate ? `${data.fedFundsRate}%` : '4.25-4.50%'}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-slate-400)' }}>Chế độ:</div>
              <div style={{ fontWeight: 700, color: assetSpecs.macroRegime === 'RESTRICTIVE' ? 'var(--color-rose-400)' : 'var(--color-emerald-400)' }}>
                {assetSpecs.macroRegime}
              </div>
            </div>
            <div>
              <div style={{ color: 'var(--text-slate-400)' }}>DXY Index:</div>
              <div style={{ fontWeight: 700, color: 'var(--text-contrast)' }}>{data?.dxy || '103.4'}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-slate-400)' }}>CPI YoY:</div>
              <div style={{ fontWeight: 700, color: 'var(--text-contrast)' }}>{data?.cpi ? `${data.cpi}%` : '2.7%'}</div>
            </div>
          </div>
        </div>

        {/* Pillar 2: On-chain Valuation */}
        <div
          onClick={() => focusOnPillarFacet('onchain')}
          style={{
            background: activeFacet === 'onchain' ? `${assetSpecs.colorCss}15` : 'var(--bg-slate-900)',
            border: activeFacet === 'onchain' ? `1px solid ${assetSpecs.colorCss}` : '1px solid var(--border-panel)',
            padding: '10px 12px',
            borderRadius: '8px',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-slate-400)', letterSpacing: '0.05em' }} className="font-mono">
              PILLAR 2: ON-CHAIN &amp; ĐỊNH GIÁ
            </span>
            <Cpu size={14} style={{ color: '#10b981' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '0.65rem' }} className="font-mono">
            <div>
              <div style={{ color: 'var(--text-slate-400)' }}>MVRV Ratio:</div>
              <div style={{ fontWeight: 700, color: assetSpecs.colorCss }}>{assetSpecs.mvrv}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-slate-400)' }}>NUPL Score:</div>
              <div style={{ fontWeight: 700, color: 'var(--text-contrast)' }}>{assetSpecs.nupl}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-slate-400)' }}>Supply In Profit:</div>
              <div style={{ fontWeight: 700, color: 'var(--color-emerald-400)' }}>{assetSpecs.supplyInProfit}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-slate-400)' }}>Địa chỉ HĐ:</div>
              <div style={{ fontWeight: 700, color: 'var(--text-contrast)' }}>{assetSpecs.activeAddresses}</div>
            </div>
          </div>
          <div style={{ fontSize: '0.6rem', color: 'var(--text-slate-400)', marginTop: '6px' }} className="font-mono">
            • Chi phí sản xuất: <span style={{ color: '#38bdf8', fontWeight: 700 }}>{assetSpecs.productionCost}</span>
          </div>
        </div>

        {/* Specimen Metadata Box */}
        <div style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)', lineHeight: 1.6 }} className="font-mono">
          <div>• Dominance: <span style={{ color: 'var(--text-contrast)', fontWeight: 700 }}>{assetSpecs.dominance}</span></div>
          <div>• Kết cấu 3D: Polyhedral Crystal Icosahedron</div>
          <div>• Trạng thái lõi: Real-time Pulse Sync</div>
        </div>
      </div>

      {/* ─── FLOATING RIGHT HUD CARD (PILLAR 3: FLOWS & PILLAR 4: DERIVATIVES) ───── */}
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
        {/* Pillar 3: Institutional Flows */}
        <div
          onClick={() => focusOnPillarFacet('flows')}
          style={{
            background: activeFacet === 'flows' ? `${assetSpecs.colorCss}15` : 'var(--bg-slate-900)',
            border: activeFacet === 'flows' ? `1px solid ${assetSpecs.colorCss}` : '1px solid var(--border-panel)',
            padding: '10px 12px',
            borderRadius: '8px',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-slate-400)', letterSpacing: '0.05em' }} className="font-mono">
              PILLAR 3: DÒNG TIỀN TỔ CHỨC
            </span>
            <Zap size={14} style={{ color: '#f59e0b' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '0.65rem' }} className="font-mono">
            <div>
              <div style={{ color: 'var(--text-slate-400)' }}>ETF Flow 7D:</div>
              <div style={{ fontWeight: 700, color: 'var(--color-emerald-400)' }}>{assetSpecs.etfFlow7d}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-slate-400)' }}>CME COT Vị Thế:</div>
              <div style={{ fontWeight: 700, color: 'var(--text-contrast)' }}>Commercial Net</div>
            </div>
          </div>
        </div>

        {/* Pillar 4: Derivatives & Microstructure */}
        <div
          onClick={() => focusOnPillarFacet('derivatives')}
          style={{
            background: activeFacet === 'derivatives' ? `${assetSpecs.colorCss}15` : 'var(--bg-slate-900)',
            border: activeFacet === 'derivatives' ? `1px solid ${assetSpecs.colorCss}` : '1px solid var(--border-panel)',
            padding: '10px 12px',
            borderRadius: '8px',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-slate-400)', letterSpacing: '0.05em' }} className="font-mono">
              PILLAR 4: PHÁI SINH &amp; POSITIONING
            </span>
            <ShieldAlert size={14} style={{ color: '#f43f5e' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '0.65rem' }} className="font-mono">
            <div>
              <div style={{ color: 'var(--text-slate-400)' }}>Funding Rate:</div>
              <div style={{ fontWeight: 700, color: 'var(--color-emerald-400)' }}>{assetSpecs.fundingRate}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-slate-400)' }}>Open Interest:</div>
              <div style={{ fontWeight: 700, color: '#38bdf8' }}>{assetSpecs.openInterest}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-slate-400)' }}>L/S Account:</div>
              <div style={{ fontWeight: 700, color: 'var(--text-contrast)' }}>{assetSpecs.lsRatio}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-slate-400)' }}>CVD 7D Delta:</div>
              <div style={{ fontWeight: 700, color: 'var(--color-emerald-400)' }}>+$185M</div>
            </div>
          </div>
        </div>

        {/* 3D Display Style Selector */}
        <div>
          <div style={{ fontSize: '0.62rem', fontWeight: 800, color: 'var(--text-slate-400)', marginBottom: '6px' }} className="font-mono">
            CHẾ ĐỘ HIỂN THỊ TINH THỂ 3D:
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px' }}>
            {[
              { id: 'solid', label: 'Nguyên khối', icon: Box },
              { id: 'wireframe', label: 'Khung lưới', icon: Eye },
              { id: 'exploded', label: 'Tách lớp', icon: Layers }
            ].map(m => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  onClick={() => setViewStyle(m.id)}
                  style={{
                    background: viewStyle === m.id ? assetSpecs.colorCss : 'var(--bg-slate-900)',
                    color: viewStyle === m.id ? '#000' : 'var(--text-slate-300)',
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
            background: isAutoRotate ? assetSpecs.colorCss : 'var(--bg-slate-900)',
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
          onClick={() => setViewStyle(viewStyle === 'exploded' ? 'solid' : 'exploded')}
          style={{
            background: viewStyle === 'exploded' ? assetSpecs.colorCss : 'var(--bg-slate-900)',
            color: viewStyle === 'exploded' ? '#000' : 'var(--text-slate-300)',
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
          <Layers size={12} /> TÁCH LỚP 3D
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
            background: assetSpecs.colorCss,
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
          <Check size={14} /> ĐÃ TẢI XUỐNG ẢNH SNAPSHOT {assetSpecs.symbol} 3D ATLAS!
        </div>
      )}
    </div>
  );
}
