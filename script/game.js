var config = {
    type: Phaser.AUTO,
    scale:{
        parent: "game",
        width: 400,
        height: 300
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

function preload ()
{
    this.load.setBaseURL('/image/');

    this.load.image('hero', 'tux.png');
    this.load.image('red', 'fire.png');
    this.load.image('sky', 'sky.jpg');
}

let hero;
var x = 0;

function create ()
{
    this.power=0;

    this.add.image(400, 300, 'sky');
    var particles = this.add.particles('red');

    var emitter = particles.createEmitter({
        speed: 100,
        scale: { start: 0.4, end: 0 },
        alpha: { start: 0.4, end: 0 },
        blendMode: 'NORMAL'
    });

    hero = this.physics.add.image(100, 500, 'hero');
    hero.scaleX = 0.5;
    hero.scaleY = 0.5;

    //hero.setVelocity(50, 100);
    hero.setBounce(0.5, 0);
    hero.setCollideWorldBounds(true);

    emitter.startFollow(hero);

    this.keyW = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyS = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.spacebar = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this.mouse = this.input.mousePointer;
    this.input.on('pointerdown', function(pointer){
        console.log("pointer : " + pointer.x, pointer.y);
        console.log("hero : " + hero.body.x, hero.body.y);
            hero.setVelocityY(-800);
            hero.setVelocityX((pointer.x - hero.body.x) * 1);
            jumpCnt++;
    }, this);
}

let jumpCnt = 0;
let jump = 0;

function updpate ()
{
    if(Phaser.Input.Keyboard.JustDown(this.spacebar) && jumpCnt < 1){
        hero.setVelocityY(-800);
        jumpCnt++;
    }else if(this.keyA.isDown && hero.body.x > 15){
        hero.setVelocityX(-500);
    }else if(this.keyS.isDown){
        hero.setVelocityX(0);
    }else if(this.keyD.isDown && hero.body.x < 685){
        hero.setVelocityX(+500);
    }

    if(hero.body.blocked.down) {
        jumpCnt = 0;
        jump = 0;
        hero.setVelocityX(hero.body.velocity.x * 0.8);
    }
    //else if(hero.body.velocity.x > 0) hero.setVelocityX(+500);

    //hero.setVelocityX(hero.body.velocity.x * 0.8);
    //console.log(hero.body.x);
}