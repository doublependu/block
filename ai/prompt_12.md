

# Features

1. Show the game's version in an unused corner of the game. 
    - template: "v.<first 4 letters of the deployed git commit>"
2. Add a new enemy type that can blast a fireball and destroy a volume of multiple blocks
    - As a reference, use the fireball effect in ~/Repos/dp-sakura-crossing
3. Add a new attack type: ice arrow
    - ice arrow can freeze the opponent temporarily
    - when the opponent is frozen, it takes more damage from the same attacks
4. Add a few new block types related to ice, when touched, has the same effect as the ice arrow 
    - defenders are immune to this
    
# Gameplay recording

1. Produce a 30 min gameplay video. 
2. the player builds a white frozen castle in survival mode
    - ref
        - block/ref/castle_2.png
        - block/ref/castle_2_1.png
    - start initial map from size large (256)
    - the castle should have 2 levels with a double curved staircase leading to the second level
        - place archer NPCs in the second level and they can attack from wall openings
3. speed up the video playback when there's a boring bit, e.g., mining, building a giant wall
    - have a mix of first person build, third person build and aerial build
4. place all available defences around the castle and in high places, make the castle feel very safe from attackers
5. export the final world of the game into a .json file, using the game's export world function


