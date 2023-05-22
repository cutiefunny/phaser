var config = {
    type: Phaser.AUTO,
    scale:{
        parent: "game2",
        width: 800,
        height: 600
    },
    transparent: true,
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 2000 }
        }
    },
    scene: {
        preload: preload,
        create: create,
        update: updpate
    }
};

var game = new Phaser.Game(config);
var hero;

function preload ()
{
    this.load.setBaseURL('/resource/adventure/');
    this.load.image('bg', 'sky.jpg');
    this.load.image('red', 'fire.png');

    this.load.spritesheet('jump', "jump.png",{ frameWidth : 160, frameHeight : 254});
    this.load.spritesheet('idle', "idle.png",{ frameWidth : 258, frameHeight : 197});
}

function create ()
{
    //this.sound.play('bgm',{volume:0.3,loop:true,seek:Math.floor(Math.random() * 350)});

    //this.add.image(400, 300, 'bg');
    var particles = this.add.particles('red');

    // var emitter = particles.createEmitter({
    //     speed: 100,
    //     scale: { start: 0.5, end: 0 },
    //     alpha: { start: 0.5, end: 0 },
    //     blendMode: 'NORMAL'
    // });

    this.anims.create({
        key: 'idle',
        frames: 'idle',
        frameRate: 10,
        repeat: -1
    });

    this.anims.create({
        key: 'jump',
        frames: 'jump',
        frameRate: 10,
        repeat: -1
    });

    hero = this.physics.add.sprite(258, 197, 'idle');

    hero.setBounce(0.5, 0);
    hero.setCollideWorldBounds(true);

    //hero.setVelocity(50, 100);

    //emitter.startFollow(ball);

    this.keyW = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyS = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.spacebar = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
}

function updpate ()
{
    if(this.keyDownState!= "W" && this.keyW.isDown){
        hero.play('jump');
        this.keyDownState = "W";
    }else{
        hero.play('idle');
        this.keyDownState = "";
    }
}