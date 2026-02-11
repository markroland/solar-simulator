import * as THREE from 'three';
import GUI from 'lil-gui';
import SunCalc from 'suncalc';

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

import Stats from 'three/addons/libs/stats.module.js';

const latitude =  37.7749; // Default: San Francisco
const longitude = -122.4194;

const targetElement = 'threejs-container';
const groundY = 0;
let container;
let renderer, scene, camera;
let controls;
let stats;

// Geometry
let cube;
let cubeGeometry;

const gui = new GUI();
gui.title('Sun Controls');
gui.hide();

const guiConfig = {
  boxSize: 1,
  latitude: latitude,
  longitude: longitude,
  dateString: new Date().toISOString().slice(0, 10),
  timeMinutes: 12 * 60,
};

const sunConfig = gui.addFolder('Sun Position');
sunConfig.add(guiConfig, 'latitude', -90, 90, 0.0001).name('Latitude').onChange(updateSunPosition);
sunConfig.add(guiConfig, 'longitude', -180, 180, 0.0001).name('Longitude').onChange(updateSunPosition);
sunConfig.add(guiConfig, 'dateString').name('Date (YYYY-MM-DD)').onChange(updateSunPosition);
sunConfig.add(guiConfig, 'timeMinutes', 0, 24 * 60, 1).name('Time (min)').onChange(updateSunPosition);

let directionalLight;
let directionalLightHelper;
let sunPathLine;
let winterSolsticeLine;
let summerSolsticeLine;
let sunInfoEl;
let sunGlow;

function createCompassRose(radius) {
  const group = new THREE.Group();

  const tickPositions = [];
  const minorLen = 0.25;
  const mediumLen = 0.4;
  const majorLen = 0.7;

  for (let deg = 0; deg < 360; deg += 5) {
    let len = minorLen;
    if (deg % 30 === 0) {
      len = majorLen;
    } else if (deg % 10 === 0) {
      len = mediumLen;
    }

    const rad = THREE.MathUtils.degToRad(deg);
    const xOuter = radius * Math.cos(rad);
    const zOuter = radius * Math.sin(rad);
    const xInner = (radius - len) * Math.cos(rad);
    const zInner = (radius - len) * Math.sin(rad);

    tickPositions.push(xInner, 0.01, zInner, xOuter, 0.01, zOuter);
  }

  const tickGeometry = new THREE.BufferGeometry();
  tickGeometry.setAttribute('position', new THREE.Float32BufferAttribute(tickPositions, 3));
  const tickMaterial = new THREE.LineBasicMaterial({ color: 0x111111 });
  const ticks = new THREE.LineSegments(tickGeometry, tickMaterial);
  group.add(ticks);

  const labelMaterialColor = '#111111';
  const labelScale = { x: 2.2, y: 0.6, z: 1 };

  function makeLabel(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = labelMaterialColor;
    ctx.font = 'bold 36px Georgia';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(labelScale.x, labelScale.y, labelScale.z);
    return sprite;
  }

  const labelOffset = 1.1;
  const north = makeLabel('NORTH');
  north.position.set(0, 0.02, -(radius + labelOffset));
  group.add(north);

  const east = makeLabel('EAST');
  east.position.set(radius + labelOffset, 0.02, 0);
  group.add(east);

  const south = makeLabel('SOUTH');
  south.position.set(0, 0.02, radius + labelOffset);
  group.add(south);

  const west = makeLabel('WEST');
  west.position.set(-(radius + labelOffset), 0.02, 0);
  group.add(west);

  return group;
}

function createSunGlowSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = canvas.width / 2;

  const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
  gradient.addColorStop(0, 'rgba(255, 244, 200, 0.95)');
  gradient.addColorStop(0.4, 'rgba(255, 210, 90, 0.6)');
  gradient.addColorStop(1, 'rgba(255, 210, 90, 0.0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.8, 1.8, 1);
  return sprite;
}

/**
 * Update the sun (directional light) position based on latitude, longitude, and time
 */
function updateSunPosition() {
  const { latitude, longitude } = guiConfig;
  const sunPos = SunCalc.getPosition(getSelectedDateTime(), latitude, longitude);
  // SunCalc azimuth is measured from south, westward positive; align to east=0, south=PI/2.
  const radius = 10; // Distance from origin
  const azimuth = sunPos.azimuth + Math.PI / 2;
  const x = radius * Math.cos(azimuth) * Math.cos(sunPos.altitude);
  const y = radius * Math.sin(sunPos.altitude);
  const z = radius * Math.sin(azimuth) * Math.cos(sunPos.altitude);
  if (directionalLight) {
    directionalLight.position.set(x, y, z);
    directionalLight.target.position.set(0, 0, 0);
    directionalLight.target.updateMatrixWorld();
    if (directionalLightHelper) {
      directionalLightHelper.update();
    }
    if (sunGlow) {
      sunGlow.position.copy(directionalLight.position);
    }
  }
  updateSunInfo(sunPos);
  updateSunPath();
}

function getSelectedDateTime() {
  const [year, month, day] = guiConfig.dateString.split('-').map(Number);
  const hours = Math.floor(guiConfig.timeMinutes / 60);
  const minutes = guiConfig.timeMinutes % 60;
  if (!year || !month || !day) {
    return new Date();
  }
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function getSelectedDate() {
  const [year, month, day] = guiConfig.dateString.split('-').map(Number);
  if (!year || !month || !day) {
    return new Date();
  }
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function formatTime(date) {
  if (!date || Number.isNaN(date.getTime())) {
    return '--:--';
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function normalizeDegrees(deg) {
  return (deg % 360 + 360) % 360;
}

function getSolsticeDates(year, latitude) {
  const isNorthernHemisphere = latitude >= 0;
  const summer = isNorthernHemisphere ? new Date(year, 5, 21) : new Date(year, 11, 21);
  const winter = isNorthernHemisphere ? new Date(year, 11, 21) : new Date(year, 5, 21);
  summer.setHours(12, 0, 0, 0);
  winter.setHours(12, 0, 0, 0);
  return { summer, winter };
}

function buildSunPathGeometry(date, latitude, longitude, radius) {
  const points = [];
  const stepMinutes = 10;

  for (let minutes = 0; minutes <= 24 * 60; minutes += stepMinutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const sample = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, mins, 0, 0);
    const sunPos = SunCalc.getPosition(sample, latitude, longitude);
    if (sunPos.altitude <= 0) {
      continue;
    }
    const azimuth = sunPos.azimuth + Math.PI / 2;
    const x = radius * Math.cos(azimuth) * Math.cos(sunPos.altitude);
    const y = radius * Math.sin(sunPos.altitude);
    const z = radius * Math.sin(azimuth) * Math.cos(sunPos.altitude);
    points.push(new THREE.Vector3(x, y, z));
  }

  return new THREE.BufferGeometry().setFromPoints(points);
}

function updateSunPath() {
  const { latitude, longitude, dateString } = guiConfig;
  const [year, month, day] = dateString.split('-').map(Number);
  if (!year || !month || !day) {
    return;
  }
  const radius = 10;
  const selectedDate = new Date(year, month - 1, day, 12, 0, 0, 0);
  const geometry = buildSunPathGeometry(selectedDate, latitude, longitude, radius);
  if (!sunPathLine) {
    const material = new THREE.LineBasicMaterial({ color: 0xffd200 });
    sunPathLine = new THREE.Line(geometry, material);
    scene.add(sunPathLine);
  } else {
    sunPathLine.geometry.dispose();
    sunPathLine.geometry = geometry;
  }

  const { summer, winter } = getSolsticeDates(year, latitude);
  const summerGeometry = buildSunPathGeometry(summer, latitude, longitude, radius);
  if (!summerSolsticeLine) {
    const summerMaterial = new THREE.LineBasicMaterial({ color: 0x00b050 });
    summerSolsticeLine = new THREE.Line(summerGeometry, summerMaterial);
    scene.add(summerSolsticeLine);
  } else {
    summerSolsticeLine.geometry.dispose();
    summerSolsticeLine.geometry = summerGeometry;
  }

  const winterGeometry = buildSunPathGeometry(winter, latitude, longitude, radius);
  if (!winterSolsticeLine) {
    const winterMaterial = new THREE.LineBasicMaterial({ color: 0xd62b2b });
    winterSolsticeLine = new THREE.Line(winterGeometry, winterMaterial);
    scene.add(winterSolsticeLine);
  } else {
    winterSolsticeLine.geometry.dispose();
    winterSolsticeLine.geometry = winterGeometry;
  }
}

function updateSunInfo(sunPos) {
  if (!sunInfoEl) {
    return;
  }
  const azimuthDeg = THREE.MathUtils.radToDeg(sunPos.azimuth);
  const altitudeDeg = THREE.MathUtils.radToDeg(sunPos.altitude);
  const times = SunCalc.getTimes(getSelectedDate(), guiConfig.latitude, guiConfig.longitude);
  const sunrise = times.sunrise;
  const sunset = times.sunset;

  const dayMinutes = sunrise && sunset
    ? Math.max(0, Math.round((sunset.getTime() - sunrise.getTime()) / 60000))
    : 0;
  const dayHours = Math.floor(dayMinutes / 60);
  const dayMins = dayMinutes % 60;

  let sunriseDeg = '--';
  let sunsetDeg = '--';
  if (sunrise && sunset) {
    const sunrisePos = SunCalc.getPosition(sunrise, guiConfig.latitude, guiConfig.longitude);
    const sunsetPos = SunCalc.getPosition(sunset, guiConfig.latitude, guiConfig.longitude);
    const sunriseAz = sunrisePos.azimuth + Math.PI / 2;
    const sunsetAz = sunsetPos.azimuth + Math.PI / 2;
    sunriseDeg = normalizeDegrees(THREE.MathUtils.radToDeg(sunriseAz)).toFixed(2);
    sunsetDeg = normalizeDegrees(THREE.MathUtils.radToDeg(sunsetAz)).toFixed(2);
  }

  sunInfoEl.textContent = [
    `Azimuth: ${azimuthDeg.toFixed(2)} deg`,
    `Altitude: ${altitudeDeg.toFixed(2)} deg`,
    `Sunrise: ${formatTime(sunrise)}`,
    `Sunset: ${formatTime(sunset)}`,
    `Daylight: ${dayHours}h ${dayMins}m`,
    `Sunrise Az: ${sunriseDeg} deg`,
    `Sunset Az: ${sunsetDeg} deg`
  ].join('\n');
}

function init() {

  // Create the renderer
  renderer = new THREE.WebGLRenderer({
    antialias: true
  });
  renderer.useLegacyLights = false;
  renderer.setPixelRatio( window.devicePixelRatio );
  renderer.setSize( window.innerWidth, window.innerHeight );
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setAnimationLoop( animate );

  // Set the container for the output
  container = document.getElementById(targetElement);
  container.innerHTML = '';
  container.appendChild( renderer.domElement );

  sunInfoEl = document.createElement('div');
  sunInfoEl.style.position = 'absolute';
  sunInfoEl.style.top = '12px';
  sunInfoEl.style.left = '12px';
  sunInfoEl.style.padding = '8px 10px';
  sunInfoEl.style.background = 'rgba(0, 0, 0, 0.6)';
  sunInfoEl.style.color = '#fff';
  sunInfoEl.style.fontFamily = 'monospace';
  sunInfoEl.style.fontSize = '12px';
  sunInfoEl.style.whiteSpace = 'pre-line';
  sunInfoEl.style.borderRadius = '4px';
  sunInfoEl.style.pointerEvents = 'none';
  container.style.position = 'relative';
  container.appendChild(sunInfoEl);

  // Create a Scene
  scene = new THREE.Scene();

  /**
   * Models
   */
  const dracoLoader = new DRACOLoader()
  dracoLoader.setDecoderPath('/draco/')

  const gltfLoader = new GLTFLoader()
  gltfLoader.setDRACOLoader(dracoLoader)

  let mixer = null

  gltfLoader.load(
    '/models/house.glb',
    (gltf) => {
      gltf.scene.rotation.y = THREE.MathUtils.degToRad(270 + 25);
      gltf.scene.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      scene.add(gltf.scene)
    },
    undefined,
    (error) => {
      console.error('Failed to load house model:', error);
    }
  )

  // Add the Camera
  camera = new THREE.PerspectiveCamera(60,
    window.innerWidth / window.innerHeight,
    1,
    100
  );
  camera.position.set(-20, 10, 0);
  camera.lookAt(0, 0, 0);

  // Add orbit controls
  controls = new OrbitControls( camera, renderer.domElement );
  controls.enableDamping = true;

  // Ambient Light
  const ambientLight = new THREE.AmbientLight( 0x999999 );
  scene.add( ambientLight );

  // Add a Directional Light
  directionalLight = new THREE.DirectionalLight(0xffffff, 5);
  directionalLight.castShadow = true;
  scene.add(directionalLight.target);
  scene.add(directionalLight);

  // Add a Directional Light Helper
  directionalLightHelper = new THREE.DirectionalLightHelper(directionalLight, 0.5, 0xff0000);
  // scene.add(directionalLightHelper);

  sunGlow = createSunGlowSprite();
  scene.add(sunGlow);

  updateSunPosition();
  updateSunPath();

  // Add Axis references
  const axesHelper = new THREE.AxesHelper( 5 );
  scene.add( axesHelper );

  // Add a Box at the origin
  /*
  cubeGeometry = new THREE.BoxGeometry(3, 1, 2);
  const cubeMaterial = new THREE.MeshStandardMaterial( {color: 0xCCCCCC} );
  cube = new THREE.Mesh( cubeGeometry, cubeMaterial );
  cube.position.y = groundY + guiConfig.boxSize / 2;
  cube.rotation.y = THREE.MathUtils.degToRad(25);
  cube.castShadow = true;
  scene.add( cube );
  //*/

  // Create a circular ground plane that can receive a shadow
  const planeGeometry = new THREE.CircleGeometry(10, 64);
  const planeMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.0, metalness: 0.0 });
  const plane = new THREE.Mesh(planeGeometry, planeMaterial);
  plane.rotation.x = -0.5 * Math.PI;
  plane.position.y = groundY;
  plane.receiveShadow = true;
  scene.add(plane);

  const compassRose = createCompassRose(10);
  scene.add(compassRose);

  // Add a resize listener
  window.addEventListener( 'resize', onWindowResize );

  // Add a performance indicator (Optional)
//   stats = new Stats();
//   document.body.appendChild( stats.dom );
}

/**
 * Update when window resizes
 **/
function onWindowResize() {
  renderer.setSize( window.innerWidth, window.innerHeight );
  camera.aspect = ( window.innerWidth / window.innerHeight );
  camera.updateProjectionMatrix();
}

/**
 * Animation callback function
 */
function animate() {
  controls.update();
  renderer.render(scene, camera);
  // stats.update();
}

// Call the initialization function to kick everything off
init();