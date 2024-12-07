import * as THREE from 'three';

const targetElement = 'threejs-container';
let container;
let renderer, scene, camera;

function init() {

    // Create the renderer
    renderer = new THREE.WebGLRenderer({
        antialias: true
    });
    renderer.useLegacyLights = false;
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( window.innerWidth, window.innerHeight );

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

    // Ambient Light
    const ambientLight = new THREE.AmbientLight( 0x999999 );
    scene.add( ambientLight );

    // Add a Directional Light
    const directionalLight = new THREE.DirectionalLight( 0xffffff, 5 );
    directionalLight.position.set(5, 2.5, 0);
    scene.add( directionalLight );

    // Add a Directional Light Helper
    const directionalLightHelper = new THREE.DirectionalLightHelper(directionalLight, 0.5);
    scene.add( directionalLightHelper );

    // Add Axis references
    const axesHelper = new THREE.AxesHelper( 5 );
    scene.add( axesHelper );

    // Add a Box at the origin
    const geometry = new THREE.BoxGeometry( 1, 1, 1 );
    const material = new THREE.MeshStandardMaterial( {color: 0xCCCCCC} );
    const cube = new THREE.Mesh( geometry, material );
    scene.add( cube );

    // Render the scene once
    renderer.render(scene, camera);
}

// Call the initialization function to kick everything off
init();