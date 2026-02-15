import * as THREE from 'three';
import GUI from 'lil-gui';
import SunCalc from 'suncalc';

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

import Stats from 'three/addons/libs/stats.module.js';

const latitude = 38.9631672;
const longitude = -95.2422898;

const targetElement = 'threejs-container';
const groundY = 0;
const ASSET_BASE_URL = import.meta.env.BASE_URL;
const SOLAR_PANEL_HEADING_DEG = 155;
const SOLAR_PANEL_TILT_DEG = 24;
let container;
let renderer, scene, camera;
let controls;
let stats;

// Geometry
let cube;
let cubeGeometry;

const gui = new GUI();
let isGuiVisible = true;

const guiConfig = {
  boxSize: 1,
  latitude: latitude,
  longitude: longitude,
  dateString: new Date().toISOString().slice(0, 10),
  timeMinutes: 0,
  systemPowerKw: 6.885,
};

const locationConfig = gui.addFolder('Location');
const latitudeController = locationConfig
  .add(guiConfig, 'latitude', -90, 90, 0.0001)
  .name('Latitude')
  .onChange(updateSunPosition);
const longitudeController = locationConfig
  .add(guiConfig, 'longitude', -180, 180, 0.0001)
  .name('Longitude')
  .onChange(updateSunPosition);

const sunConfig = gui.addFolder('Date & Time');
const dateStringController = sunConfig
  .add(guiConfig, 'dateString')
  .name('Date (YYYY-MM-DD)')
  .onChange(updateSunPosition);
let autoTimeIntervalId = null;
const timeMinutesController = sunConfig
  .add(guiConfig, 'timeMinutes', 0, 24 * 60, 1)
  .name('Time (min)')
  .onChange(() => {
    // Stop the automated time update if the user adjusts the time via GUI
    if (autoTimeIntervalId !== null) {
      clearInterval(autoTimeIntervalId);
      autoTimeIntervalId = null;
    }
    updateSunPosition();
  });
sunConfig.add({ now: setDateAndTimeToNow }, 'now').name('Now');

const solarPanelConfig = gui.addFolder('Solar Panel');
solarPanelConfig
  .add(guiConfig, 'systemPowerKw', 0.1, 10, 0.01)
  .name('System Power (kW)');

let directionalLight;
let directionalLightHelper;
let sunPathLine;
let winterSolsticeLine;
let summerSolsticeLine;

let sunInfoEl;
let sunGlow;
let compassTicksLine;
let heading155Line;
let heading155TiltedLine;


// Line showing sun direction from center to edge
let sunDirectionLine;
// Lines for sunrise and sunset directions
let sunriseDirectionLine;
let sunsetDirectionLine;

// Sprites for sunrise, current, and sunset degree labels
let sunriseLabelSprite;
let sunsetLabelSprite;
let sunCurrentLabelSprite;

function makeDegreeLabel(text, color = '#FFD700') {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.font = 'bold 32px Helvetica';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.2, 0.6, 1);
  return sprite;
}

function toCompassHeadingDegrees(sunCalcAzimuthRad) {
  const heading = (THREE.MathUtils.radToDeg(sunCalcAzimuthRad) + 180) % 360;
  return heading < 0 ? heading + 360 : heading;
}

function disposeLine2(line) {
  if (!line) {
    return;
  }
  scene.remove(line);
  line.geometry.dispose();
  line.material.dispose();
}

function disposeSprite(sprite) {
  if (!sprite) {
    return;
  }
  scene.remove(sprite);
  if (sprite.material?.map) {
    sprite.material.map.dispose();
  }
  sprite.material.dispose();
}

function onKeyDown(event) {
  const targetTag = event.target?.tagName;
  const isTypingTarget = targetTag === 'INPUT' || targetTag === 'TEXTAREA' || event.target?.isContentEditable;
  if (isTypingTarget) {
    return;
  }

  if (event.code === 'Space') {
    event.preventDefault();
    if (controls) {
      controls.autoRotate = !controls.autoRotate;
    }
    return;
  }

  if (event.key?.toLowerCase() === 'h') {
    if (isGuiVisible) {
      gui.hide();
    } else {
      gui.show();
    }
    isGuiVisible = !isGuiVisible;
  }
}

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

  const tickGeometry = new LineSegmentsGeometry();
  tickGeometry.setPositions(tickPositions);
  const tickMaterial = new LineMaterial({
    color: 0x111111,
    linewidth: 3,
    resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
  });
  compassTicksLine = new LineSegments2(tickGeometry, tickMaterial);
  compassTicksLine.computeLineDistances();
  group.add(compassTicksLine);

  const labelMaterialColor = '#FFFFFF';
  const labelScale = { x: 2.2, y: 0.6, z: 1 };

  function makeLabel(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = labelMaterialColor;
    ctx.font = 'bold 36px Helvetica';
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

function createGroundHeadingLine(headingDegrees, radius = 10) {
  const angleRad = THREE.MathUtils.degToRad(headingDegrees - 90);
  const x = radius * Math.cos(angleRad);
  const z = radius * Math.sin(angleRad);

  const geometry = new LineGeometry();
  geometry.setPositions([0, 0.01, 0, x, 0.01, z]);

  const material = new LineMaterial({
    color: 0x333333,
    linewidth: 2,
    resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
  });

  const line = new Line2(geometry, material);
  line.computeLineDistances();
  return line;
}

function createTiltedHeadingLine(headingDegrees, tiltUpDegrees, length = 10) {
  const headingRad = THREE.MathUtils.degToRad(headingDegrees - 90);
  const tiltRad = THREE.MathUtils.degToRad(tiltUpDegrees);

  const horizontalLength = length * Math.cos(tiltRad);
  const x = horizontalLength * Math.cos(headingRad);
  const y = length * Math.sin(tiltRad);
  const z = horizontalLength * Math.sin(headingRad);

  const geometry = new LineGeometry();
  geometry.setPositions([0, 0.01, 0, x, y + 0.01, z]);

  const material = new LineMaterial({
    color: 0x666666,
    linewidth: 2,
    resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
  });

  const line = new Line2(geometry, material);
  line.computeLineDistances();
  return line;
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

function createSolarPanelMesh() {
  const panelWidth = 1.5;
  const panelHeight = 2.5;
  const panelGeometry = new THREE.PlaneGeometry(panelWidth, panelHeight);
  // Lay panel flat in XZ plane and move it so one edge is anchored at local z=0.
  panelGeometry.rotateX(-Math.PI / 2);
  panelGeometry.translate(0, 0, -panelHeight / 2);
  const panelMaterial = new THREE.MeshStandardMaterial({
    color: 0x1f3f7a,
    metalness: 0.35,
    roughness: 0.25,
    side: THREE.DoubleSide
  });
  const panelMesh = new THREE.Mesh(panelGeometry, panelMaterial);
  panelMesh.castShadow = false;
  panelMesh.receiveShadow = false;
  return panelMesh;
}

/**
 * Update the sun (directional light) position based on latitude, longitude, and time
 */
function updateSunPosition() {
  const { latitude, longitude } = guiConfig;
  const sunPos = SunCalc.getPosition(getSelectedDateTime(), latitude, longitude);

  // Sky color: noon sky-blue, sunset dark-blue, night black.
  let skyColor;
  if (renderer) {
    const nightColor = new THREE.Color('#000000');
    const sunsetColor = new THREE.Color('#0a2342');
    const dayColor = new THREE.Color('#87ceeb');
    if (sunPos.altitude <= 0) {
      const nightBlend = THREE.MathUtils.clamp((sunPos.altitude + 0.2) / 0.2, 0, 1);
      skyColor = new THREE.Color().lerpColors(nightColor, sunsetColor, nightBlend);
    } else {
      const dayBlend = THREE.MathUtils.clamp(sunPos.altitude / 1.2, 0, 1);
      skyColor = new THREE.Color().lerpColors(sunsetColor, dayColor, dayBlend);
    }
    renderer.setClearColor(skyColor, 1);
  }

  if (compassTicksLine && skyColor) {
    compassTicksLine.material.color.copy(skyColor);
  }

  disposeSprite(sunriseLabelSprite);
  disposeSprite(sunsetLabelSprite);
  disposeSprite(sunCurrentLabelSprite);
  sunriseLabelSprite = null;
  sunsetLabelSprite = null;
  sunCurrentLabelSprite = null;

  disposeLine2(sunDirectionLine);
  disposeLine2(sunriseDirectionLine);
  disposeLine2(sunsetDirectionLine);
  sunDirectionLine = null;
  sunriseDirectionLine = null;
  sunsetDirectionLine = null;

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
    directionalLight.intensity = sunPos.altitude > 0 ? 5 : 0;
  }

  // Current sun direction line and heading label (only above horizon).
  if (sunPos.altitude > 0) {
    const xEdge = radius * Math.cos(azimuth);
    const zEdge = radius * Math.sin(azimuth);
    const lineGeom = new LineGeometry();
    lineGeom.setPositions([0, 0.01, 0, xEdge, 0.01, zEdge]);
    const lineMat = new LineMaterial({
      color: 0xB8860B, // dark yellow (goldenrod)
      linewidth: 4,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
    });
    sunDirectionLine = new Line2(lineGeom, lineMat);
    sunDirectionLine.computeLineDistances();
    scene.add(sunDirectionLine);

    const currentHeading = toCompassHeadingDegrees(sunPos.azimuth);
    sunCurrentLabelSprite = makeDegreeLabel(`${currentHeading.toFixed(1)}°`, '#B8860B');
    sunCurrentLabelSprite.position.set(xEdge * 1.08, 0.02, zEdge * 1.08);
    scene.add(sunCurrentLabelSprite);
  }

  // Sunrise and sunset direction lines and heading labels.
  const times = SunCalc.getTimes(getSelectedDate(), latitude, longitude);
  if (times.sunrise && times.sunset) {
    const sunrisePos = SunCalc.getPosition(times.sunrise, latitude, longitude);
    const sunsetPos = SunCalc.getPosition(times.sunset, latitude, longitude);
    const sunriseAz = sunrisePos.azimuth + Math.PI / 2;
    const sunsetAz = sunsetPos.azimuth + Math.PI / 2;
    // Project to XZ plane
    const xSunrise = radius * Math.cos(sunriseAz);
    const zSunrise = radius * Math.sin(sunriseAz);
    const xSunset = radius * Math.cos(sunsetAz);
    const zSunset = radius * Math.sin(sunsetAz);

    const sunriseGeom = new LineGeometry();
    sunriseGeom.setPositions([0, 0.01, 0, xSunrise, 0.01, zSunrise]);
    const sunriseMat = new LineMaterial({
      color: 0xFFD700, // yellow
      linewidth: 3,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
    });
    sunriseDirectionLine = new Line2(sunriseGeom, sunriseMat);
    sunriseDirectionLine.computeLineDistances();
    scene.add(sunriseDirectionLine);

    const sunriseHeading = toCompassHeadingDegrees(sunrisePos.azimuth);
    sunriseLabelSprite = makeDegreeLabel(`${sunriseHeading.toFixed(1)}°`, '#FFD700');
    sunriseLabelSprite.position.set(xSunrise * 1.08, 0.02, zSunrise * 1.08);
    scene.add(sunriseLabelSprite);

    const sunsetGeom = new LineGeometry();
    sunsetGeom.setPositions([0, 0.01, 0, xSunset, 0.01, zSunset]);
    const sunsetMat = new LineMaterial({
      color: 0xFFD700, // yellow
      linewidth: 3,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
    });
    sunsetDirectionLine = new Line2(sunsetGeom, sunsetMat);
    sunsetDirectionLine.computeLineDistances();
    scene.add(sunsetDirectionLine);

    const sunsetHeading = toCompassHeadingDegrees(sunsetPos.azimuth);
    sunsetLabelSprite = makeDegreeLabel(`${sunsetHeading.toFixed(1)}°`, '#FFD700');
    sunsetLabelSprite.position.set(xSunset * 1.08, 0.02, zSunset * 1.08);
    scene.add(sunsetLabelSprite);
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

function updateTimeMinutesToNow() {
  const now = new Date();
  guiConfig.timeMinutes = now.getHours() * 60 + now.getMinutes();
  timeMinutesController.updateDisplay();
  updateSunPosition();
}

function setDateAndTimeToNow() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  guiConfig.dateString = `${year}-${month}-${day}`;
  guiConfig.timeMinutes = now.getHours() * 60 + now.getMinutes();
  dateStringController.updateDisplay();
  timeMinutesController.updateDisplay();
  updateSunPosition();
}

function parseLocationFromUrl() {
  const urlText = `${window.location.pathname}${window.location.search}`;
  const match = urlText.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
}

function applyLocationFromUrl() {
  const coords = parseLocationFromUrl();
  if (!coords) {
    return;
  }
  guiConfig.latitude = coords.lat;
  guiConfig.longitude = coords.lng;
  latitudeController.updateDisplay();
  longitudeController.updateDisplay();
  updateSunPosition();
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
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function normalizeDegrees(deg) {
  return (deg % 360 + 360) % 360;
}

function getPanelNormalVector(headingDegrees, tiltDegrees) {
  const headingRad = THREE.MathUtils.degToRad(headingDegrees - 90);
  const tiltRad = THREE.MathUtils.degToRad(tiltDegrees);
  const horizontal = new THREE.Vector3(Math.cos(headingRad), 0, Math.sin(headingRad));
  return new THREE.Vector3(0, 1, 0)
    .multiplyScalar(Math.cos(tiltRad))
    .add(horizontal.multiplyScalar(Math.sin(tiltRad)))
    .normalize();
}

function getSunDirectionVector(sunPos) {
  const azimuth = sunPos.azimuth + Math.PI / 2;
  const altitude = sunPos.altitude;
  return new THREE.Vector3(
    Math.cos(azimuth) * Math.cos(altitude),
    Math.sin(altitude),
    Math.sin(azimuth) * Math.cos(altitude)
  ).normalize();
}

function getPanelIncidenceFactor(sunPos, panelHeadingDegrees, panelTiltDegrees) {
  const panelNormal = getPanelNormalVector(panelHeadingDegrees, panelTiltDegrees);
  const sunDirection = getSunDirectionVector(sunPos);
  return Math.max(0, panelNormal.dot(sunDirection));
}

function getPanelPivotYawFromHeading(headingDegrees) {
  return normalizeDegrees(180 - headingDegrees);
}

function getDailyPeakIncidence(date, latitude, longitude, panelHeadingDegrees, panelTiltDegrees) {
  const peak = {
    factor: 0,
    time: null
  };
  const stepMinutes = 5;
  const baseDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  for (let minutes = 0; minutes <= 24 * 60; minutes += stepMinutes) {
    const sample = new Date(baseDate);
    sample.setMinutes(minutes);
    const sunPos = SunCalc.getPosition(sample, latitude, longitude);
    if (sunPos.altitude <= 0) {
      continue;
    }
    const factor = getPanelIncidenceFactor(sunPos, panelHeadingDegrees, panelTiltDegrees);
    if (factor > peak.factor) {
      peak.factor = factor;
      peak.time = sample;
    }
  }
  return peak;
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
  const positions = [];
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
    positions.push(x, y, z);
  }

  const geometry = new LineGeometry();
  geometry.setPositions(positions);
  return geometry;
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
    const material = new LineMaterial({
      color: 0xffd200,
      linewidth: 2,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
    });
    sunPathLine = new Line2(geometry, material);
    sunPathLine.computeLineDistances();
    scene.add(sunPathLine);
  } else {
    sunPathLine.geometry.dispose();
    sunPathLine.geometry = geometry;
  }

  const { summer, winter } = getSolsticeDates(year, latitude);
  const summerGeometry = buildSunPathGeometry(summer, latitude, longitude, radius);
  if (!summerSolsticeLine) {
    const summerMaterial = new LineMaterial({
      color: 0x00b050,
      linewidth: 1,
      transparent: true,
      opacity: 0.5,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
    });
    summerSolsticeLine = new Line2(summerGeometry, summerMaterial);
    summerSolsticeLine.computeLineDistances();
    scene.add(summerSolsticeLine);
  } else {
    summerSolsticeLine.geometry.dispose();
    summerSolsticeLine.geometry = summerGeometry;
  }

  const winterGeometry = buildSunPathGeometry(winter, latitude, longitude, radius);
  if (!winterSolsticeLine) {
    const winterMaterial = new LineMaterial({
      color: 0xd62b2b,
      linewidth: 1,
      transparent: true,
      opacity: 0.5,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
    });
    winterSolsticeLine = new Line2(winterGeometry, winterMaterial);
    winterSolsticeLine.computeLineDistances();
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
  const [year, month, day] = guiConfig.dateString.split('-').map(Number);
  const formattedDate = year && month && day ? `${month}/${day}/${year}` : '--/--/----';
  const azimuthDeg = THREE.MathUtils.radToDeg(sunPos.azimuth);
  const altitudeDeg = THREE.MathUtils.radToDeg(sunPos.altitude);
  const selectedTime = getSelectedDateTime();
  const times = SunCalc.getTimes(getSelectedDate(), guiConfig.latitude, guiConfig.longitude);
  const sunrise = times.sunrise;
  const sunset = times.sunset;
  const incidenceFactor = getPanelIncidenceFactor(sunPos, SOLAR_PANEL_HEADING_DEG, SOLAR_PANEL_TILT_DEG);
  const aoiDegrees = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(incidenceFactor, 0, 1)));
  const dailyPeak = getDailyPeakIncidence(
    getSelectedDate(),
    guiConfig.latitude,
    guiConfig.longitude,
    SOLAR_PANEL_HEADING_DEG,
    SOLAR_PANEL_TILT_DEG
  );
  const estimatedPowerKw = guiConfig.systemPowerKw * incidenceFactor;
  const estimatedPeakPowerKw = guiConfig.systemPowerKw * dailyPeak.factor;

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
    `Date: ${formattedDate}`,
    `Time: ${formatTime(selectedTime)}`,
    `Latitude: ${guiConfig.latitude.toFixed(4)}`,
    `Longitude: ${guiConfig.longitude.toFixed(4)}`,
    `Azimuth: ${azimuthDeg.toFixed(2)} deg`,
    `Altitude: ${altitudeDeg.toFixed(2)} deg`,
    `Sunrise: ${formatTime(sunrise)}`,
    `Sunset: ${formatTime(sunset)}`,
    `Daylight: ${dayHours}h ${dayMins}m`,
    `Panel Head: ${SOLAR_PANEL_HEADING_DEG.toFixed(1)} deg`,
    `Panel Tilt: ${SOLAR_PANEL_TILT_DEG.toFixed(1)} deg`,
    `System Power: ${guiConfig.systemPowerKw.toFixed(3)} kW`,
    `AOI: ${aoiDegrees.toFixed(2)} deg`,
    `Incidence: ${(incidenceFactor * 100).toFixed(1)}%`,
    `Est. Power: ${estimatedPowerKw.toFixed(3)} kW`,
    `Peak Incidence: ${(dailyPeak.factor * 100).toFixed(1)}% @ ${formatTime(dailyPeak.time)}`,
    `Est. Peak: ${estimatedPeakPowerKw.toFixed(3)} kW`,
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

  applyLocationFromUrl();
  window.addEventListener('popstate', applyLocationFromUrl);

  updateTimeMinutesToNow();
  autoTimeIntervalId = setInterval(updateTimeMinutesToNow, 5000);

  /**
   * Models
   */
  const dracoLoader = new DRACOLoader()
  dracoLoader.setDecoderPath(`${ASSET_BASE_URL}draco/`)

  const gltfLoader = new GLTFLoader()
  gltfLoader.setDRACOLoader(dracoLoader)

  let mixer = null

  gltfLoader.load(
    `${ASSET_BASE_URL}models/house.glb`,
    (gltf) => {
      gltf.scene.rotation.y = THREE.MathUtils.degToRad(270 + 25);
      // gltf.scene.rotation.y = THREE.MathUtils.degToRad(270);
      gltf.scene.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      const solarPanelPivot = new THREE.Group();
      const solarPanel = createSolarPanelMesh();

      // Keep bottom edge on a fixed Y plane.
      solarPanelPivot.position.set(1.7, 1.2, 1.4);
      // Rotate around vertical axis (compensated so visual mesh matches compass heading).
      const panelPivotYawDeg = getPanelPivotYawFromHeading(SOLAR_PANEL_HEADING_DEG);
      solarPanelPivot.rotation.y = THREE.MathUtils.degToRad(panelPivotYawDeg);
      // Tilt panel about its anchored bottom edge.
      solarPanel.rotation.x = THREE.MathUtils.degToRad(SOLAR_PANEL_TILT_DEG);

      // solarPanelPivot.position.x += 1.4;
      // solarPanelPivot.position.z += 1.8;

      solarPanelPivot.add(solarPanel);

      // solarPanel.rotation.z += THREE.MathUtils.degToRad(270);
      // solarPanel.rotation.z += THREE.MathUtils.degToRad(45);
      // solarPanel.rotation.x += THREE.MathUtils.degToRad(24);
      // solarPanel.rotation.y += THREE.MathUtils.degToRad(-25);
      // solarPanel.position.x += 0.7;
      // solarPanel.position.z += 1.0;

      // solarPanel.rotation.z = 0.5 * Math.PI;
      // solarPanel.rotation.copy(gltf.scene.rotation);
      // solarPanel.scale.copy(gltf.scene.scale);
      // solarPanel.position.y += 4;
      // solarPanel.rotation.x = THREE.MathUtils.degToRad(-35);

      scene.add(gltf.scene);
      scene.add(solarPanelPivot);
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
  camera.position.set(-18, 10, 0);
  camera.lookAt(0, 0, 0);

  // Add orbit controls
  controls = new OrbitControls( camera, renderer.domElement );
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.4;
  controls.maxPolarAngle = Math.PI / 2;
  controls.minDistance = 10;
  controls.maxDistance = 40;

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
  // const axesHelper = new THREE.AxesHelper( 5 );
  // scene.add( axesHelper );

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

  heading155Line = createGroundHeadingLine(155, 10);
  scene.add(heading155Line);

  heading155TiltedLine = createTiltedHeadingLine(155, 90 - 24, 10);
  scene.add(heading155TiltedLine);

  window.addEventListener('keydown', onKeyDown);

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
  if (compassTicksLine) {
    compassTicksLine.material.resolution.set(window.innerWidth, window.innerHeight);
  }
  if (sunPathLine) {
    sunPathLine.material.resolution.set(window.innerWidth, window.innerHeight);
  }
  if (summerSolsticeLine) {
    summerSolsticeLine.material.resolution.set(window.innerWidth, window.innerHeight);
  }
  if (winterSolsticeLine) {
    winterSolsticeLine.material.resolution.set(window.innerWidth, window.innerHeight);
  }
  if (heading155Line) {
    heading155Line.material.resolution.set(window.innerWidth, window.innerHeight);
  }
  if (heading155TiltedLine) {
    heading155TiltedLine.material.resolution.set(window.innerWidth, window.innerHeight);
  }
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