window.onload = function() {

};

var config = {
    type: Phaser.AUTO,
    scale:{
        parent: "game",
        width: 400,
        height: 800
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
    this.load.setBaseURL('/resource/');

    this.load.image('hero', 'tux.png');
    this.load.image('red', 'fire.png');
    this.load.image('sky', 'sky.jpg');

    this.load.image('bg', 'bg.png');
    this.load.image('p1', 'p1.png');
    this.load.image('p2', 'p2.png');
    this.load.image('p3', 'p3.png');
    this.load.image('ball', 'ball.png');

    this.load.audio('reps', 'reps.mp3');
    this.load.audio('noReps', 'no reps.mp3');
    this.load.audio('bgm', 'bgm.mp3');
    this.load.audio('321', '321.mp3');
}

let hero;
var x = 0;
var reps = 0;
var time = 60;
let timer;
let timerBoard;
let startBoard;
let saveBoard;
let bgm;
let cnt;
let end = false;

function create ()
{
    this.power=0;
    //this.sound.play('bgm',{volume:0.3,loop:true,seek:Math.floor(Math.random() * 350)});
    cnt = this.sound.add('321');
    bgm = this.sound.add('bgm');

    this.add.image(200, 400, 'bg');
    var particles = this.add.particles('red');

    // var emitter = particles.createEmitter({
    //     speed: 100,
    //     scale: { start: 0.5, end: 0 },
    //     alpha: { start: 0.5, end: 0 },
    //     blendMode: 'NORMAL'
    // });
    

    ball = this.physics.add.image(200, 560, 'ball');
    ball.scaleX = 1.5;
    ball.scaleY = 1.5;

    hero = this.add.image(200, 570, 'p1');
    hero.scaleX = 1.5;
    hero.scaleY = 1.5;

    //hero.setVelocity(50, 100);
    ball.setBounce(0.5, 0);
    ball.setCollideWorldBounds(true);

    this.score = this.add.text(20, 20, 'reps: '+reps, { fontFamily: 'Arial',fontSize: '32px', fill: '#000' });
    timerBoard = this.add.text(330, 20, time, { fontFamily: 'Arial',fontSize: '32px', fill: 'blue' });
    startBoard = this.add.text(80, 300, 'click to start', { fontFamily: 'Arial',fontSize: '50px', fill: 'blue', backgroundColor: 'white' });

    timer = this.time.addEvent({
        delay: 1000,                // ms
        callback: setTimer,
        repeat: 60
    });
    timer.paused = true;

    //emitter.startFollow(ball);

    this.keyW = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyS = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.spacebar = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this.click = this.input.activePointer;

    //this.mouse = this.input.mousePointer;
    // this.input.on('pointerdown', function(pointer){
    //     hero.setVelocityY((pointer.y - hero.body.y) * 5);
    //     hero.setVelocityX((pointer.x - hero.body.x) * 1);
    // }, this);

    this.input.on('pointerup', function(pointer){
        //console.log(this.click.buttons==1 ? "click" : "no");
        //var speed = (pointer.upTime - pointer.downTime)/100;
        startBoard.setText('');
        timer.paused = false;
        if(end){
            end=false;
            reps = 0;
            time = 60;
            timer.reset({
                delay: 1000,                // ms
                callback: setTimer,
                repeat: 60
            });
            timer.paused = false;
            this.score.setText('reps: '+reps);
            timerBoard.setText(time);
        }
        if(ball.y == 560){
            var speed = 1;
            console.log(pointer);
            ball.setVelocityY(((pointer.upY - pointer.downY) * 5)/speed);
            ball.setVelocityX(((pointer.upX - pointer.downX) * 0.5)/speed);
        }
    }, this);
    // this.input.on('dragstart', function(pointer){
    //     console.log(pointer);
    //     hero.setVelocityY((pointer.y - hero.body.y) * 5);
    //     hero.setVelocityX((pointer.x - hero.body.x) * 1);
    // }, this);
}

let jumpCnt = 0;
let jump = 0;
let isJump = false;
let check = false;

function updpate ()
{
    // if(this.click.isDown){
    //     hero.setVelocityX((pointer.x - hero.body.x) * 3);
    // }

    if(Phaser.Input.Keyboard.JustDown(this.spacebar) && jumpCnt < 1){
        ball.setVelocityY(-800);
        jumpCnt++;
    }else if(this.keyA.isDown && ball.body.x > 15){
        ball.setVelocityX(-500);
    }else if(this.keyS.isDown){
        ball.setVelocityX(0);
    }else if(this.keyD.isDown && ball.body.x < 685){
        ball.setVelocityX(+500);
    }

    // if(ball.y==560) {
    //     jumpCnt = 0;
    //     jump = 0;
    //     ball.setVelocityX(ball.body.velocity.x * 0.8);
    // }

    if(ball.body.blocked.up) this.sound.play('noReps');

    if(ball.y <400) hero.setTexture('p3');
    else if(ball.y < 550) hero.setTexture('p2');
    else {
        ball.y = 560;
        ball.body.velocity.y = 0;
        ball.body.velocity.x = 0;
        hero.setTexture('p1');
        check = false;
    }

    if(ball.body.speed<20 && ball.y < 400 && !check) {
        if(ball.y > 30 && ball.y < 120 && ball.x > 160 && ball.x < 240){
            this.sound.play('reps');
            reps++;
            this.score.setText('reps: '+reps);
            check = true;
        }else{
            this.sound.play('noReps');
            check = true;
        }
    }

    hero.x = ball.x;
    //else if(hero.body.velocity.x > 0) hero.setVelocityX(+500);

    //hero.setVelocityX(hero.body.velocity.x * 0.8);
    //console.log(hero.body.x);
}

function setTimer(){
    time--;
    //console.log(time);
    timerBoard.setText(time);
    if(time < 11) timerBoard.setFill('red');
    if(time == 3){
        cnt.play();
        //this.scene.start('end', {reps: reps});
    }
    if(time == 0){

        timer.paused = true;

        $('.ui.modal').modal('show');
        $('#score').text(reps);
        $("#modalCancel").show();
        $("#modalOk").show();
        $('#modalOk').click(function(){
            let score = reps;
            let name = $('#player').val();

            callFetchApi('POST', '/saveScore', JSON.stringify({game: "wallballshot", name: name, score: score}));

            //$('.ui.modal').modal('hide');
            startBoard.setPosition(50, 300);
            startBoard.setText('score :'+ reps +'\nclick to restart');
            end = true;
        });
        // end = true;
    }
}