// init.scd

s.waitForBoot {
    {
        SinOsc.ar(440, 0, 0.2) ! 2 // stereo sine wave
    }.play;
};