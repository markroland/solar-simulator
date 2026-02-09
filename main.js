import * as THREE from 'three';
import GUI from 'lil-gui';

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import Stats from 'three/addons/libs/stats.module.js';

const targetElement = 'threejs-container';
let container;
let renderer, scene, camera;
let controls;
let stats;

// Geometry
let cube;
let cubeGeometry;

const gui = new GUI();

const guiConfig = {
  boxSize: 1
};

const boxConfig = gui.addFolder('Box');
boxConfig.add( guiConfig, 'boxSize', 0.1, 5.0, 0.1).name('Size').onChange( value => {

  // Create a new BoxGeometry
  cubeGeometry.dispose();
  cubeGeometry = new THREE.BoxGeometry(value, value, value);

  // Assign the new geometry to the cube
  cube.geometry = cubeGeometry;
  cube.geometry.computeBoundingBox();
  cube.geometry.attributes.position.needsUpdate = true;
});

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

  // Create a Scene
  scene = new THREE.Scene();

  // Add the Camera
  camera = new THREE.PerspectiveCamera(60,
    window.innerWidth / window.innerHeight,
    1,
    100
  );
  camera.position.set(10, 10, 10);
  camera.lookAt(0, 0, 0);

  // Add orbit controls
  controls = new OrbitControls( camera, renderer.domElement );
  controls.enableDamping = true;

  // Ambient Light
  const ambientLight = new THREE.AmbientLight( 0x999999 );
  scene.add( ambientLight );

  // Add a Directional Light
  const directionalLight = new THREE.DirectionalLight( 0xffffff, 5 );
  directionalLight.position.set(5, 2.5, 0);
  directionalLight.castShadow = true;
  scene.add( directionalLight );

  // Add a Directional Light Helper
  const directionalLightHelper = new THREE.DirectionalLightHelper(directionalLight, 0.5);
  scene.add( directionalLightHelper );

  // Add Axis references
  const axesHelper = new THREE.AxesHelper( 5 );
  scene.add( axesHelper );

  // Add a Box at the origin
  cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
  const cubeMaterial = new THREE.MeshStandardMaterial( {color: 0xCCCCCC} );
  cube = new THREE.Mesh( cubeGeometry, cubeMaterial );
  cube.castShadow = true;
  scene.add( cube );

  // Create a ground plane that can receive a shadow
  const planeGeometry = new THREE.PlaneGeometry(10, 10);
  const planeMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.0, metalness: 0.0 });
  const plane = new THREE.Mesh(planeGeometry, planeMaterial);
  plane.rotation.x = -0.5 * Math.PI;
  plane.position.y = -0.5;
  plane.receiveShadow = true;
  scene.add(plane);

  // Add a resize listener
  window.addEventListener( 'resize', onWindowResize );

  // Add a performance indicator (Optional)
  stats = new Stats();
  document.body.appendChild( stats.dom );
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

  // required if controls.enableDamping or controls.autoRotate are set to true
  controls.update();

  renderer.render( scene, camera );

  stats.update();
}

// Call the initialization function to kick everything off
init();