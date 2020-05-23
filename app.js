'use strict'

const dahua = require('dahua-cam');
const mqtt = require('mqtt')
const winston = require('winston');
const onvif = require('onvif');

const argv = require('yargs')
    .env()
    .option('mqtt', {
        alias: 'm',
        type: 'string',
        description: 'MQTT URL'
      })
      .option('mqttTopicRoot', {
          alias: 'r',
          type: 'string',
          description: 'topic root to post messages to'
      })
      .option('username', {
        alias: 'u',
        type: 'string',
        description: 'Username to connect to discovered cams'
      })
      .option('password', {
        alias: 'p',
        type: 'string',
        description: 'Password to connect to discovered cams'
      })
    .option('logLevel', {
        alias: 'l',
        type: 'string',
        description: 'Logging level (debug/info/warn/error)'
      })
      .option('discover', {
          alias: 'd',
          type: 'boolean',
          description: 'Discover local cams with ONVIF'
      })
      .array('cam')
      .option('cam', {
          alias: 'c',
          type: 'string',
          description: "Cam as <hostname>:<port> (or omit :<port> for default port)"
      })
      .default('mqttTopicRoot', 'cam/dahua')
      .default('logLevel', 'info')
      .default('cam', [])
      .default('discover', false)
      .demandOption(['mqtt', 'username', 'password'])
    .argv;

const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
        winston.format.splat(),
        winston.format.simple()
    ),
    transports: [
        new winston.transports.Console()
    ]
});

//todo detect connection failures
let mqttClient = mqtt.connect(argv.mqtt)
mqttClient.on('error', function (error) {
    logger.error("Error from mqtt broker: %v", error)
});
mqttClient.on('connect', function () {
    logger.info(`Connected to mqtt broker at ${argv.mqtt}`)
});

let suppliedCams = argv.cam.map(camString => {
    let [host,port] = camString.split(':');
    return {
        host,
        port
    }
});

if(argv.discover){
    onvif.Discovery.probe(function(err, cams) {
        // function will be called only after timeout (5 sec by default)
        if (err) { 
            logger.error("Failed to discover cameras: " + err);
            throw err; 
        }

        runCams(suppliedCams.concat(cams.map(c => ({
            host: c.host,
            port: c.port
        }))));
    });
} else {
    if(suppliedCams.length == 0) {
        logger.error('No cams supplied and discovery disabled!');
        process.exit(1);
    }
    runCams(suppliedCams);
}

function runCams(cams){

    for(let camDef of cams) {
        logger.info(`Connecting to camera at: ${camDef.host}`);
        
        let cam = new dahua.DahuaCam({
            host: camDef.host,
            port: camDef.port,
            username: argv.username,
            password: argv.password
        });

        cam.name().then(name => {
            name = name.trim();
            cam.on("alarm", (code, action, index) => {
                logger.debug(`Received alarm ${code}, ${action}, ${index}`);
                logger.debug(`Publishing to ${argv.mqttTopicRoot}/name/${name}/code/${code}/action/${action}/index/${index}`);
                mqttClient.publish(`${argv.mqttTopicRoot}/name/${name}/code/${code}/action/${action}/index/${index}`, JSON.stringify({
                    host: camDef.host,
                    port: camDef.port,
                    name,
                    code, 
                    action, 
                    index
                }));
            });
    
            cam.listenForEvents();
        }).error(logger.error)
    }
}