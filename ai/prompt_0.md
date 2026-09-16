

1. Build a complete voxel game
    - to start with, let's do static webpage, single player
    - but keep in mind that I'd like this to be a multiplayer game in the future, where the following functions are provided by 1 or 2 separate generic servers:
        - player login, player character model and texture
        - socket to keep world state and player location in sync
        - when these servers are offline, the app defaults back to single player, static page
        - I'd like to make these servers generic and capable of supporting other games that are completely different to this one
            - This means all world data, game logic, etc, is in the static app
            - and the generic servers do not need to know these
2. The world
    - option to generate a world from a seed
    - option to load a world from a list
        - make one as default, "play" will load this world
    - option to export the current world into: seed + all mining and building activities to date
        - I'd like to be able to commit these exports to a git repo
        - this will form the world list that the player can load from
    - I don't need the following options:
        - import an existing world
        - save the current world to the world list
        - only way to add a new world to the world list is through the git repo, by changing the source code / static website data
3. The gameplay: kind of a tower defence game
    - the player can build in peace or with minor skirmish
    - the player use this time to mine blocks, collect resources, build defence structures and place defence troops
    - when night arrives, hoards of NPCs will start attacking and see if they can survive all defence structures and troops and destroy the town center
        - the player can watch from an aerial view
        - or he can join the defence crew as one of the defence NPCs
        - or he can join the attack crew as one of the attacking NPCs!
        - when he dies, he can choose to be another NPC or watch from the aerial view
    - when it's day time again, the town recovers automatically and the player can continue with its mining and construction activity
    - the next night, the attack crew is a little bit stronger, given that the player had another day to build things. 
    - In creative mode, the player can build forever in daylight without mining anything
        - he can then select how strong he wants the attack crew to be when he's ready to test things out
4. Refer to ai/prompt_0_ext.md as to what needs to be built on top of the noa engine
5. In this first iteration of building this game, create some placeholder NPC and player character models
    - use blender tools to make these models and package them, their textures, rigging and animation loops as glb files
    - use common animation loop names like: idle, walk, run, mine block, place block, attack, shoot, hold item, hold bow, hold sword, hold gun, etc
        - not all of these apply to all NPC and player character models
    - I will update these glb files later
    - note that the player can play as any NPC character!
    - In the future, I'd like one of the generic servers to provide these glb files, in a multiplayer setup, the player can play as the external glb file
6. You can start from a reference implementation using the noa engine
    - https://github.com/fenomas/noa-examples
        - hello-world or testbed
    - Here's the noa engine itself: https://github.com/fenomas/noa

