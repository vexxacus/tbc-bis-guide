/**
 * WowSimBridge — minimal bridge till wowsims WASM
 *
 * Kommunicerar med sim_worker.js via binärt protobuf (hand-encodat).
 * Hanterar bara det vi behöver: RaidSimRequest för DPS-specs.
 *
 * Protobuf wire types:
 *   0 = varint, 1 = 64-bit, 2 = length-delimited, 5 = 32-bit
 * Field tag = (field_number << 3) | wire_type
 */

// ─── Minimal protobuf encoder ───────────────────────────────────────────────

class ProtoWriter {
    constructor() { this._buf = []; }

    // Encode unsigned varint
    _varint(n) {
        n = n >>> 0;
        while (n > 0x7f) {
            this._buf.push((n & 0x7f) | 0x80);
            n = n >>> 7;
        }
        this._buf.push(n & 0x7f);
    }

    // Write field tag
    _tag(field, wireType) { this._varint((field << 3) | wireType); }

    // field: varint
    fieldVarint(field, value) {
        if (!value && value !== 0) return;
        this._tag(field, 0);
        this._varint(value);
    }

    // field: length-delimited (bytes / nested message)
    fieldBytes(field, bytes) {
        if (!bytes || !bytes.length) return;
        this._tag(field, 2);
        this._varint(bytes.length);
        for (const b of bytes) this._buf.push(b);
    }

    // field: nested message (another ProtoWriter)
    fieldMessage(field, writer) {
        const bytes = writer.finish();
        if (bytes.length) this.fieldBytes(field, bytes);
    }

    finish() { return new Uint8Array(this._buf); }
}

// ─── Proto field constants (from proto/api.proto + proto/common.proto) ──────
// Arms-specific talent fields
const WT_DEFLECTION                  = 3;   // arms: parry — not needed, keep at 0
const WT_IMPROVED_REND_ARMS          = 2;   // 0 in Arms build
const WT_IMPALE                      = 9;   // 2 (arms: impale)
const WT_ANGER_MANAGEMENT_ARMS       = 6;   // 1 (arms: anger management)
const WT_DEEP_WOUNDS_ARMS            = 7;   // 3 (arms: deep wounds)
const WT_TWO_HAND_WEAPON_SPEC        = 8;   // 3 (arms: 2h weapon spec)
const WT_MORTAL_STRIKE               = 10;  // 1 (arms: mortal strike, bool)

// RaidSimRequest fields
const RSR_RAID        = 1;
const RSR_ENCOUNTER   = 2;
const RSR_SIM_OPTIONS = 3;

// Raid fields
const RAID_PARTIES  = 1;
const RAID_BUFFS    = 2;
const RAID_DEBUFFS  = 5;

// Party fields
const PARTY_PLAYERS = 1;
const PARTY_BUFFS   = 2;

// Player fields
const PLAYER_RACE      = 1;
const PLAYER_CLASS     = 2;
const PLAYER_EQUIPMENT = 3;
const PLAYER_CONSUMES  = 4;
const PLAYER_BUFFS     = 15;
const PLAYER_NAME      = 16;
// spec oneof — Warrior = field 14
const PLAYER_WARRIOR   = 14;

// EquipmentSpec field
const EQUIP_ITEMS = 1;

// ItemSpec fields
const ITEM_ID      = 2;
const ITEM_ENCHANT = 3;
const ITEM_GEMS    = 4;

// Encounter fields
const ENC_DURATION           = 1;
const ENC_DURATION_VARIATION = 4;
const ENC_EXECUTE_PROPORTION = 3;
const ENC_TARGETS            = 2;

// Target fields
const TARGET_LEVEL    = 4;
const TARGET_MOB_TYPE = 3;

// SimOptions fields
const SIMOPT_ITERATIONS  = 1;
const SIMOPT_RANDOM_SEED = 2;

// Warrior fields (proto/warrior.proto) — Warrior message wraps Rotation/Talents/Options
const WARRIOR_ROTATION = 1;
const WARRIOR_TALENTS  = 2;
const WARRIOR_OPTIONS  = 3;

// Warrior.Rotation fields (nested inside Warrior message)
const WR_USE_OVERPOWER        = 1;
const WR_USE_HAMSTRING        = 2;
const WR_USE_SLAM             = 3;
const WR_PRIORITIZE_WW        = 4;
const WR_HS_RAGE_THRESHOLD    = 5;   // double
const WR_OVERPOWER_RAGE_THRESHOLD = 6; // double
const WR_HAMSTRING_RAGE_THRESHOLD = 7; // double
const WR_RAMPAGE_CD_THRESHOLD = 8;   // double
const WR_SLAM_LATENCY         = 9;   // double
const WR_USE_HS_DURING_EXECUTE  = 10;
const WR_USE_WW_DURING_EXECUTE  = 11;
const WR_USE_MS_DURING_EXECUTE  = 12;
const WR_USE_BT_DURING_EXECUTE  = 13;
const WR_USE_CLEAVE           = 14;
const WR_SUNDER_ARMOR         = 15;  // enum: 2 = SunderArmorMaintain
const WR_SLAM_GCD_DELAY       = 19;  // double
const WR_SLAM_MS_WW_DELAY     = 20;  // double

// WarriorTalents fields — Fury talents for "3500501130201-05050005505012050115"
// Arms tree
const WT_IMPROVED_HEROIC_STRIKE       = 1;   // 3
const WT_IMPROVED_REND                = 2;   // 0
const WT_IMPROVED_CHARGE              = 3;   // 0
const WT_IMPROVED_THUNDER_CLAP        = 4;   // 0
const WT_ANGER_MANAGEMENT            = 6;   // bool true? no, '0' in fury spec
const WT_DEEP_WOUNDS                 = 7;   // 0
const WT_TWO_HAND_SPEC               = 8;   // 0
// Fury tree
const WT_BOOMING_VOICE               = 19;  // 0
const WT_CRUELTY                     = 20;  // 5
const WT_UNBRIDLED_WRATH             = 21;  // 5
const WT_IMPROVED_CLEAVE             = 22;  // 0
const WT_COMMANDING_PRESENCE         = 23;  // 1
const WT_DUAL_WIELD_SPEC             = 24;  // 1 (was 0 in string but let's use 1)
const WT_IMPROVED_EXECUTE            = 25;  // 3
const WT_IMPROVED_SLAM               = 26;  // 0
const WT_SWEEPING_STRIKES            = 27;  // bool
const WT_WEAPON_MASTERY              = 28;  // 2
const WT_IMPROVED_BERSERKER_RAGE     = 29;  // 0
const WT_FLURRY                      = 30;  // 5
const WT_PRECISION                   = 31;  // 3
const WT_BLOODTHIRST                 = 32;  // bool true
const WT_IMPROVED_WW                 = 33;  // 0
const WT_IMPROVED_BERSERKER_STANCE   = 34;  // 5
const WT_RAMPAGE                     = 35;  // bool true
const WT_ENDLESS_RAGE                = 18;  // bool true

// WarriorOptions fields
const WO_STARTING_RAGE     = 1;
const WO_USE_RECKLESSNESS  = 2;
const WO_SHOUT             = 3;  // enum: 1 = Battle Shout
const WO_PRECAST_SHOUT     = 4;

// ─── Shadow Priest proto fields ──────────────────────────────────────────────
// Player spec oneof field for Shadow Priest (from proto/api.proto)
const PLAYER_SHADOW_PRIEST = 10;  // ShadowPriest spec field in Player oneof (proto: shadow_priest = 10)

// ShadowPriest message fields (rotation=1, talents=2, options=3)
const SP_ROTATION = 1;
const SP_TALENTS  = 2;
const SP_OPTIONS  = 3;

// ShadowPriest_Rotation fields
const SPR_ROTATION_TYPE  = 1;  // enum: 0=Basic, 1=Clipping, 2=Ideal
const SPR_USE_DEV_PLAGUE = 2;  // bool (undead only)
const SPR_USE_STARSHARDS = 3;  // bool (night elf only)
const SPR_PRECAST_VT     = 4;  // bool
const SPR_LATENCY        = 5;  // double (ms)

// ShadowPriest_Rotation_RotationType enum values
const SP_ROTATION_IDEAL    = 2;  // Ideal (best DPS)

// ShadowPriest_Options fields
const SPO_USE_SHADOWFIEND = 1;  // bool

// PriestTalents fields — Standard 0/5/56 shadow build
// Discipline tree
const PT_INNER_FOCUS              = 9;   // bool (field 9)
const PT_MEDITATION               = 10;  // 3
// Shadow tree — all fields ≥ 19 based on proto ordering
const PT_SHADOW_AFFINITY          = 19;  // 3
const PT_IMP_SHADOW_WORD_PAIN     = 21;  // 2
const PT_SHADOW_FOCUS             = 22;  // 5
const PT_IMP_MIND_BLAST           = 23;  // 5
const PT_MIND_FLAY                = 24;  // bool true
const PT_SHADOW_WEAVING           = 25;  // 5
const PT_VAMPIRIC_EMBRACE         = 26;  // bool true
const PT_FOCUSED_MIND             = 27;  // 3
const PT_DARKNESS                 = 29;  // 5
const PT_SHADOWFORM               = 30;  // bool true
const PT_SHADOW_POWER             = 31;  // 4
const PT_MISERY                   = 32;  // 5
const PT_VAMPIRIC_TOUCH           = 33;  // bool true

// Shadow Priest consumes (field numbers from proto/common.proto Consumes + enum values)
const CONS_SP_FLASK          = 38;  // enum: FlaskOfPureDeath = 3
const CONS_SP_FOOD           = 41;  // enum: FoodBlackenedBasilisk = 1
const CONS_SP_DEFAULT_POTION = 15;  // enum: SuperManaPotion = 2
const CONS_SP_MH_IMBUE       = 32;  // enum: WeaponImbueSuperiorWizardOil = 4

// IndividualBuffs for casters (field numbers from proto/common.proto IndividualBuffs)
const IB_BLESSING_OF_WISDOM    = 2;  // TristateEffect: 2 = Improved (blessing_of_wisdom = 2)
const IB_BLESSING_OF_SALVATION = 8;  // bool true (blessing_of_salvation = 8)

// RaidBuffs for casters (field numbers from proto/common.proto RaidBuffs message)
const RB_ARCANE_BRILLIANCE   = 1;  // bool true (arcane_brilliance = 1)
const RB_DIVINE_SPIRIT        = 4;  // TristateEffect: 2 = Improved (divine_spirit = 4)

// Debuffs for shadow priests (field numbers from proto/common.proto Debuffs message)
const DB_JUDGEMENT_OF_WISDOM = 1;   // bool (judgement_of_wisdom = 1)
const DB_MISERY              = 3;   // bool — 5% spell hit (misery = 3)
const DB_CURSE_OF_ELEMENTS   = 4;   // TristateEffect: 1 = Regular (curse_of_elements = 4)
const DB_SHADOW_WEAVING      = 18;  // bool — 5-stack shadow weaving (shadow_weaving = 18)

// Class enum
const CLASS_PRIEST  = 5;
// Race enum
const RACE_UNDEAD   = 11;  // RaceUndead = 11 (from proto/common.proto Race enum)

// Consumes fields (melee — kept for warrior)
const CONS_FLASK          = 38;  // enum: 4 = FlaskOfRelentlessAssault
const CONS_FOOD           = 41;  // enum: 4 = FoodRoastedClefthoof
const CONS_DEFAULT_POTION = 15;  // enum: 3 = HastePotion
const CONS_MH_IMBUE       = 32;  // enum: 1 = AdamantiteSharpeningStone
const CONS_OH_IMBUE       = 33;

// IndividualBuffs fields
const IB_BLESSING_OF_KINGS = 1;
const IB_BLESSING_OF_MIGHT = 3;  // TristateEffect: 2 = Improved

// RaidBuffs fields
const RB_GIFT_OF_THE_WILD = 5;   // TristateEffect: 2 = Improved

// Debuffs fields
const DB_SUNDER_ARMOR      = 11;  // bool
const DB_FAERIE_FIRE       = 10;  // TristateEffect: 2 = Improved
const DB_EXPOSE_ARMOR      = 9;   // TristateEffect: 1 = Regular
const DB_CURSE_OF_RECKLESSNESS = 12;

// Race enum
const RACE_ORC = 7;
// Class enum
const CLASS_WARRIOR = 9;
// MobType enum
const MOB_TYPE_DEMON = 2;

// ─── Double → little-endian IEEE 754 bytes ──────────────────────────────────

function doubleBytes(v) {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, v, true);
    return new Uint8Array(buf);
}

// Write a double field (wire type 1 = 64-bit)
function writeDouble(pw, field, value) {
    pw._tag(field, 1);
    const bytes = doubleBytes(value);
    for (const b of bytes) pw._buf.push(b);
}

// ─── Build the RaidSimRequest binary ────────────────────────────────────────

function buildRaidSimRequest(gearSlots, iterations, randomSeed) {
    // ── ItemSpec per slot ──
    const equipSpec = new ProtoWriter();
    for (const slot of gearSlots) {
        const itemSpec = new ProtoWriter();
        itemSpec.fieldVarint(ITEM_ID, slot.id);
        if (slot.enchant) itemSpec.fieldVarint(ITEM_ENCHANT, slot.enchant);
        for (const gem of (slot.gems || [])) itemSpec.fieldVarint(ITEM_GEMS, gem);
        equipSpec.fieldMessage(EQUIP_ITEMS, itemSpec);
    }

    // ── Warrior Rotation ──
    // Fury BT+WW rotation — values from wowsims presets.ts DefaultRotation
    const rotation = new ProtoWriter();
    // bool fields (varint)
    rotation.fieldVarint(WR_USE_OVERPOWER, 0);         // false
    rotation.fieldVarint(WR_USE_HAMSTRING, 1);          // true (default)
    rotation.fieldVarint(WR_USE_SLAM, 0);               // false for Fury
    rotation.fieldVarint(WR_PRIORITIZE_WW, 0);          // false
    rotation.fieldVarint(WR_SUNDER_ARMOR, 2);           // SunderArmorMaintain = 2
    rotation.fieldVarint(WR_USE_HS_DURING_EXECUTE, 1);  // true
    rotation.fieldVarint(WR_USE_BT_DURING_EXECUTE, 1);  // true
    rotation.fieldVarint(WR_USE_WW_DURING_EXECUTE, 1);  // true
    rotation.fieldVarint(WR_USE_MS_DURING_EXECUTE, 1);  // true
    // double fields (wire type 1)
    writeDouble(rotation, WR_HS_RAGE_THRESHOLD, 60.0);         // 60 rage
    writeDouble(rotation, WR_OVERPOWER_RAGE_THRESHOLD, 10.0);  // 10 rage
    writeDouble(rotation, WR_HAMSTRING_RAGE_THRESHOLD, 75.0);  // 75 rage
    writeDouble(rotation, WR_RAMPAGE_CD_THRESHOLD, 5.0);       // 5 sec

    // ── WarriorTalents — Fury: "3500501130201-05050005505012050115" ──
    const furyTalents = new ProtoWriter();
    // CRITICAL non-zero Fury talents (confirmed field numbers from proto)
    furyTalents.fieldVarint(WT_IMPROVED_HEROIC_STRIKE, 3);    // arms: 3
    furyTalents.fieldVarint(WT_CRUELTY, 5);                   // 20 = cruelty 5
    furyTalents.fieldVarint(WT_UNBRIDLED_WRATH, 5);           // 21 = unbridled_wrath 5
    furyTalents.fieldVarint(WT_COMMANDING_PRESENCE, 1);       // 23 = commanding_presence 1
    furyTalents.fieldVarint(WT_IMPROVED_EXECUTE, 3);           // 25 = improved_execute 3 (from arm pos 9 = 3)
    furyTalents.fieldVarint(WT_WEAPON_MASTERY, 2);             // 28 = weapon_mastery 2
    furyTalents.fieldVarint(WT_FLURRY, 5);                     // 30 = flurry 5
    furyTalents.fieldVarint(WT_PRECISION, 3);                   // 31 = precision 3
    furyTalents.fieldVarint(WT_BLOODTHIRST, 1);                // 32 = bloodthirst (bool)
    furyTalents.fieldVarint(WT_IMPROVED_BERSERKER_STANCE, 5); // 34 = improved_berserker_stance 5
    furyTalents.fieldVarint(WT_RAMPAGE, 1);                    // 35 = rampage (bool)

    // ── WarriorOptions ──
    const options = new ProtoWriter();
    writeDouble(options, WO_STARTING_RAGE, 0.0);      // double field!
    options.fieldVarint(WO_USE_RECKLESSNESS, 1);       // true
    options.fieldVarint(WO_SHOUT, 1);                  // Battle Shout
    options.fieldVarint(WO_PRECAST_SHOUT, 1);

    // ── Warrior spec (Warrior message = rotation + talents + options) ──
    const warriorSpec = new ProtoWriter();
    warriorSpec.fieldMessage(WARRIOR_ROTATION, rotation);
    warriorSpec.fieldMessage(WARRIOR_TALENTS, furyTalents);  // FIELD 2 — was missing!
    warriorSpec.fieldMessage(WARRIOR_OPTIONS, options);

    // ── Consumes ──
    const consumes = new ProtoWriter();
    consumes.fieldVarint(CONS_FLASK, 4);           // FlaskOfRelentlessAssault
    consumes.fieldVarint(CONS_FOOD, 4);            // FoodRoastedClefthoof
    consumes.fieldVarint(CONS_DEFAULT_POTION, 3);  // HastePotion
    consumes.fieldVarint(CONS_MH_IMBUE, 1);        // AdamantiteSharpeningStone
    consumes.fieldVarint(CONS_OH_IMBUE, 1);

    // ── Individual buffs ──
    const indBuffs = new ProtoWriter();
    indBuffs.fieldVarint(IB_BLESSING_OF_KINGS, 1);  // true
    indBuffs.fieldVarint(IB_BLESSING_OF_MIGHT, 2);  // Improved

    // ── Player ──
    const player = new ProtoWriter();
    // name field (16) — string, wire type 2
    const nameBytes = new TextEncoder().encode('Fury Warrior');
    player.fieldBytes(PLAYER_NAME, nameBytes);
    player.fieldVarint(PLAYER_RACE, RACE_ORC);
    player.fieldVarint(PLAYER_CLASS, CLASS_WARRIOR);
    player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
    player.fieldMessage(PLAYER_CONSUMES, consumes);
    player.fieldMessage(PLAYER_BUFFS, indBuffs);
    player.fieldMessage(PLAYER_WARRIOR, warriorSpec);

    // ── Party ──
    const partyBuffs = new ProtoWriter();
    partyBuffs.fieldVarint(4, 1); // flask_of_relentless_assault in PartyBuffs... 
    // Actually just leave party buffs minimal — main buffs are raid-level

    const party = new ProtoWriter();
    party.fieldMessage(PARTY_PLAYERS, player);

    // ── Raid buffs ──
    const raidBuffs = new ProtoWriter();
    raidBuffs.fieldVarint(RB_GIFT_OF_THE_WILD, 2); // Improved Gift of the Wild

    // ── Debuffs ──
    const debuffs = new ProtoWriter();
    debuffs.fieldVarint(DB_SUNDER_ARMOR, 1);             // true
    debuffs.fieldVarint(DB_FAERIE_FIRE, 2);              // Improved
    debuffs.fieldVarint(DB_CURSE_OF_RECKLESSNESS, 1);    // true

    // ── Raid ──
    const raid = new ProtoWriter();
    raid.fieldMessage(RAID_PARTIES, party);
    raid.fieldMessage(RAID_BUFFS, raidBuffs);
    raid.fieldMessage(RAID_DEBUFFS, debuffs);

    // ── Target (level 73 Demon) ──
    // Target fields: level=4, mob_type=3, min_base_damage=7, swing_speed=8
    const target = new ProtoWriter();
    target.fieldVarint(TARGET_LEVEL, 73);
    target.fieldVarint(TARGET_MOB_TYPE, MOB_TYPE_DEMON);
    writeDouble(target, 7, 4000.0);   // min_base_damage (placeholder — sim uses defaults)
    writeDouble(target, 8, 2.0);       // swing_speed = 2.0 sec

    // ── Encounter ──
    const encounter = new ProtoWriter();
    writeDouble(encounter, ENC_DURATION, 300.0);           // 5 min fight
    writeDouble(encounter, ENC_DURATION_VARIATION, 5.0);
    writeDouble(encounter, ENC_EXECUTE_PROPORTION, 0.2);   // 20% execute phase
    encounter.fieldMessage(ENC_TARGETS, target);

    // ── SimOptions ──
    const simOptions = new ProtoWriter();
    simOptions.fieldVarint(SIMOPT_ITERATIONS, iterations || 3000);
    // random_seed is int64 field 2 — encode as varint
    simOptions.fieldVarint(SIMOPT_RANDOM_SEED, randomSeed || Math.floor(Math.random() * 0x7fffffff));

    // ── RaidSimRequest ──
    const rsr = new ProtoWriter();
    rsr.fieldMessage(RSR_RAID, raid);
    rsr.fieldMessage(RSR_ENCOUNTER, encounter);
    rsr.fieldMessage(RSR_SIM_OPTIONS, simOptions);

    return rsr.finish();
}

// ─── Build RaidSimRequest for Arms Warrior (33/28/0, 2H, Orc) ──────────────

function buildArmsSimRequest(gearSlots, iterations, randomSeed) {
    // ── ItemSpec per slot ──
    const equipSpec = new ProtoWriter();
    for (const slot of gearSlots) {
        const itemSpec = new ProtoWriter();
        itemSpec.fieldVarint(ITEM_ID, slot.id);
        if (slot.enchant) itemSpec.fieldVarint(ITEM_ENCHANT, slot.enchant);
        for (const gem of (slot.gems || [])) itemSpec.fieldVarint(ITEM_GEMS, gem);
        equipSpec.fieldMessage(EQUIP_ITEMS, itemSpec);
    }

    // ── Arms Rotation (MS → WW → Slam weave) ──
    const rotation = new ProtoWriter();
    rotation.fieldVarint(WR_USE_OVERPOWER, 1);           // true — Arms uses Overpower
    rotation.fieldVarint(WR_USE_HAMSTRING, 0);           // false
    rotation.fieldVarint(WR_USE_SLAM, 1);                // true — Slam weave
    rotation.fieldVarint(WR_PRIORITIZE_WW, 0);           // false — MS first
    rotation.fieldVarint(WR_SUNDER_ARMOR, 2);            // SunderArmorMaintain
    rotation.fieldVarint(WR_USE_HS_DURING_EXECUTE, 1);   // true
    rotation.fieldVarint(WR_USE_MS_DURING_EXECUTE, 1);   // true
    rotation.fieldVarint(WR_USE_WW_DURING_EXECUTE, 1);   // true
    rotation.fieldVarint(WR_USE_BT_DURING_EXECUTE, 0);   // false — no BT for Arms
    writeDouble(rotation, WR_HS_RAGE_THRESHOLD, 60.0);
    writeDouble(rotation, WR_OVERPOWER_RAGE_THRESHOLD, 10.0);
    writeDouble(rotation, WR_HAMSTRING_RAGE_THRESHOLD, 75.0);
    writeDouble(rotation, WR_SLAM_LATENCY, 0.1);          // 100ms slam latency
    writeDouble(rotation, WR_SLAM_GCD_DELAY, 0.0);
    writeDouble(rotation, WR_SLAM_MS_WW_DELAY, 0.0);

    // ── Arms Talents: 33/28/0 build ──
    const armsTalents = new ProtoWriter();
    // Arms tree (fields 1-18)
    armsTalents.fieldVarint(WT_IMPROVED_HEROIC_STRIKE, 3);   // 1: imp heroic strike 3
    armsTalents.fieldVarint(WT_ANGER_MANAGEMENT_ARMS, 1);    // 6: anger management
    armsTalents.fieldVarint(WT_DEEP_WOUNDS_ARMS, 3);         // 7: deep wounds 3
    armsTalents.fieldVarint(WT_TWO_HAND_WEAPON_SPEC, 3);     // 8: 2h weapon spec 3
    armsTalents.fieldVarint(WT_IMPALE, 2);                   // 9: impale 2
    armsTalents.fieldVarint(WT_MORTAL_STRIKE, 1);            // 10: mortal strike
    // Fury tree (fields 19-35) — 28 points
    armsTalents.fieldVarint(WT_CRUELTY, 5);                  // 20: cruelty 5
    armsTalents.fieldVarint(WT_UNBRIDLED_WRATH, 5);          // 21: unbridled wrath 5
    armsTalents.fieldVarint(WT_COMMANDING_PRESENCE, 1);      // 23: commanding presence 1
    armsTalents.fieldVarint(WT_IMPROVED_EXECUTE, 2);         // 25: improved execute 2
    armsTalents.fieldVarint(WT_SWEEPING_STRIKES, 1);         // 27: sweeping strikes
    armsTalents.fieldVarint(WT_WEAPON_MASTERY, 2);           // 28: weapon mastery 2
    armsTalents.fieldVarint(WT_FLURRY, 5);                   // 30: flurry 5
    armsTalents.fieldVarint(WT_PRECISION, 3);                // 31: precision 3

    // ── WarriorOptions ──
    const options = new ProtoWriter();
    writeDouble(options, WO_STARTING_RAGE, 0.0);
    options.fieldVarint(WO_USE_RECKLESSNESS, 0);  // Arms uses Death Wish instead — not modeled
    options.fieldVarint(WO_SHOUT, 1);             // Battle Shout
    options.fieldVarint(WO_PRECAST_SHOUT, 1);

    // ── Warrior spec message ──
    const warriorSpec = new ProtoWriter();
    warriorSpec.fieldMessage(WARRIOR_ROTATION, rotation);
    warriorSpec.fieldMessage(WARRIOR_TALENTS, armsTalents);
    warriorSpec.fieldMessage(WARRIOR_OPTIONS, options);

    // ── Consumes (no OH imbue for 2H) ──
    const consumes = new ProtoWriter();
    consumes.fieldVarint(CONS_FLASK, 4);           // FlaskOfRelentlessAssault
    consumes.fieldVarint(CONS_FOOD, 4);            // FoodRoastedClefthoof
    consumes.fieldVarint(CONS_DEFAULT_POTION, 3);  // HastePotion
    consumes.fieldVarint(CONS_MH_IMBUE, 1);        // AdamantiteSharpeningStone on 2H

    // ── Individual buffs ──
    const indBuffs = new ProtoWriter();
    indBuffs.fieldVarint(IB_BLESSING_OF_KINGS, 1);
    indBuffs.fieldVarint(IB_BLESSING_OF_MIGHT, 2);

    // ── Player ──
    const player = new ProtoWriter();
    player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Arms Warrior'));
    player.fieldVarint(PLAYER_RACE, RACE_ORC);
    player.fieldVarint(PLAYER_CLASS, CLASS_WARRIOR);
    player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
    player.fieldMessage(PLAYER_CONSUMES, consumes);
    player.fieldMessage(PLAYER_BUFFS, indBuffs);
    player.fieldMessage(PLAYER_WARRIOR, warriorSpec);

    const party = new ProtoWriter();
    party.fieldMessage(PARTY_PLAYERS, player);

    const raidBuffs = new ProtoWriter();
    raidBuffs.fieldVarint(RB_GIFT_OF_THE_WILD, 2);

    const debuffs = new ProtoWriter();
    debuffs.fieldVarint(DB_SUNDER_ARMOR, 1);
    debuffs.fieldVarint(DB_FAERIE_FIRE, 2);
    debuffs.fieldVarint(DB_CURSE_OF_RECKLESSNESS, 1);

    const raid = new ProtoWriter();
    raid.fieldMessage(RAID_PARTIES, party);
    raid.fieldMessage(RAID_BUFFS, raidBuffs);
    raid.fieldMessage(RAID_DEBUFFS, debuffs);

    const target = new ProtoWriter();
    target.fieldVarint(TARGET_LEVEL, 73);
    target.fieldVarint(TARGET_MOB_TYPE, MOB_TYPE_DEMON);
    writeDouble(target, 7, 4000.0);
    writeDouble(target, 8, 2.0);

    const encounter = new ProtoWriter();
    writeDouble(encounter, ENC_DURATION, 300.0);
    writeDouble(encounter, ENC_DURATION_VARIATION, 5.0);
    writeDouble(encounter, ENC_EXECUTE_PROPORTION, 0.2);
    encounter.fieldMessage(ENC_TARGETS, target);

    const simOptions = new ProtoWriter();
    simOptions.fieldVarint(SIMOPT_ITERATIONS, iterations || 3000);
    simOptions.fieldVarint(SIMOPT_RANDOM_SEED, randomSeed || Math.floor(Math.random() * 0x7fffffff));

    const rsr = new ProtoWriter();
    rsr.fieldMessage(RSR_RAID, raid);
    rsr.fieldMessage(RSR_ENCOUNTER, encounter);
    rsr.fieldMessage(RSR_SIM_OPTIONS, simOptions);

    return rsr.finish();
}

// ─── Build RaidSimRequest for Shadow Priest (0/5/56, Undead) ─────────────────

function buildShadowPriestSimRequest(gearSlots, iterations, randomSeed) {
    // ── ItemSpec per slot ──
    const equipSpec = new ProtoWriter();
    for (const slot of gearSlots) {
        const itemSpec = new ProtoWriter();
        itemSpec.fieldVarint(ITEM_ID, slot.id);
        if (slot.enchant) itemSpec.fieldVarint(ITEM_ENCHANT, slot.enchant);
        for (const gem of (slot.gems || [])) itemSpec.fieldVarint(ITEM_GEMS, gem);
        equipSpec.fieldMessage(EQUIP_ITEMS, itemSpec);
    }

    // ── ShadowPriest Rotation — Ideal rotation ──
    const rotation = new ProtoWriter();
    rotation.fieldVarint(SPR_ROTATION_TYPE, SP_ROTATION_IDEAL);  // Ideal
    rotation.fieldVarint(SPR_USE_DEV_PLAGUE, 1);                  // true — Undead gets Devouring Plague
    rotation.fieldVarint(SPR_PRECAST_VT, 1);                      // true — precast VT
    writeDouble(rotation, SPR_LATENCY, 50.0);                     // 50ms latency

    // ── PriestTalents — Standard 0/5/56 shadow build ──
    const talents = new ProtoWriter();
    // Discipline tree
    talents.fieldVarint(PT_INNER_FOCUS, 1);              // 9: inner focus (bool)
    talents.fieldVarint(PT_MEDITATION, 3);               // 10: meditation 3
    // Shadow tree
    talents.fieldVarint(PT_SHADOW_AFFINITY, 3);          // 19: shadow affinity 3
    talents.fieldVarint(PT_IMP_SHADOW_WORD_PAIN, 2);     // 21: imp shadow word pain 2
    talents.fieldVarint(PT_SHADOW_FOCUS, 5);             // 22: shadow focus 5
    talents.fieldVarint(PT_IMP_MIND_BLAST, 5);           // 23: imp mind blast 5
    talents.fieldVarint(PT_MIND_FLAY, 1);                // 24: mind flay (bool)
    talents.fieldVarint(PT_SHADOW_WEAVING, 5);           // 25: shadow weaving 5
    talents.fieldVarint(PT_VAMPIRIC_EMBRACE, 1);         // 26: vampiric embrace (bool)
    talents.fieldVarint(PT_FOCUSED_MIND, 3);             // 27: focused mind 3
    talents.fieldVarint(PT_DARKNESS, 5);                 // 29: darkness 5
    talents.fieldVarint(PT_SHADOWFORM, 1);               // 30: shadowform (bool)
    talents.fieldVarint(PT_SHADOW_POWER, 4);             // 31: shadow power 4
    talents.fieldVarint(PT_MISERY, 5);                   // 32: misery 5
    talents.fieldVarint(PT_VAMPIRIC_TOUCH, 1);           // 33: vampiric touch (bool)

    // ── ShadowPriest Options ──
    const options = new ProtoWriter();
    options.fieldVarint(SPO_USE_SHADOWFIEND, 1);  // use shadowfiend

    // ── ShadowPriest spec message ──
    const spSpec = new ProtoWriter();
    spSpec.fieldMessage(SP_ROTATION, rotation);
    spSpec.fieldMessage(SP_TALENTS, talents);
    spSpec.fieldMessage(SP_OPTIONS, options);

    // ── Consumes (caster) ──
    const consumes = new ProtoWriter();
    consumes.fieldVarint(CONS_SP_FLASK, 3);           // FlaskOfPureDeath = 3
    consumes.fieldVarint(CONS_SP_FOOD, 1);            // FoodBlackenedBasilisk = 1
    consumes.fieldVarint(CONS_SP_DEFAULT_POTION, 2);  // SuperManaPotion = 2
    consumes.fieldVarint(CONS_SP_MH_IMBUE, 4);        // WeaponImbueSuperiorWizardOil = 4

    // ── Individual buffs ──
    const indBuffs = new ProtoWriter();
    indBuffs.fieldVarint(IB_BLESSING_OF_KINGS, 1);      // true
    indBuffs.fieldVarint(IB_BLESSING_OF_WISDOM, 2);     // Improved Blessing of Wisdom
    indBuffs.fieldVarint(IB_BLESSING_OF_SALVATION, 1);  // true

    // ── Player ──
    const player = new ProtoWriter();
    player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Shadow Priest'));
    player.fieldVarint(PLAYER_RACE, RACE_UNDEAD);
    player.fieldVarint(PLAYER_CLASS, CLASS_PRIEST);
    player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
    player.fieldMessage(PLAYER_CONSUMES, consumes);
    player.fieldMessage(PLAYER_BUFFS, indBuffs);
    player.fieldMessage(PLAYER_SHADOW_PRIEST, spSpec);

    const party = new ProtoWriter();
    party.fieldMessage(PARTY_PLAYERS, player);

    // ── Raid buffs ──
    const raidBuffs = new ProtoWriter();
    raidBuffs.fieldVarint(RB_ARCANE_BRILLIANCE, 1);  // true
    raidBuffs.fieldVarint(RB_DIVINE_SPIRIT, 2);       // Improved Divine Spirit
    raidBuffs.fieldVarint(RB_GIFT_OF_THE_WILD, 2);   // Improved Gift of the Wild

    // ── Debuffs — Misery + Shadow Weaving + Improved Faerie Fire + CoE ──
    const debuffs = new ProtoWriter();
    debuffs.fieldVarint(DB_JUDGEMENT_OF_WISDOM, 1); // Judgement of Wisdom (field 1)
    debuffs.fieldVarint(DB_MISERY, 1);              // Misery (5% spell hit, field 3)
    debuffs.fieldVarint(DB_CURSE_OF_ELEMENTS, 1);   // Curse of Elements regular (field 4)
    debuffs.fieldVarint(DB_FAERIE_FIRE, 2);         // Improved Faerie Fire (field 10)
    debuffs.fieldVarint(DB_SHADOW_WEAVING, 1);      // 5-stack Shadow Weaving (field 18)

    const raid = new ProtoWriter();
    raid.fieldMessage(RAID_PARTIES, party);
    raid.fieldMessage(RAID_BUFFS, raidBuffs);
    raid.fieldMessage(RAID_DEBUFFS, debuffs);

    // ── Target (level 73 Undead) ──
    const target = new ProtoWriter();
    target.fieldVarint(TARGET_LEVEL, 73);
    target.fieldVarint(TARGET_MOB_TYPE, 3);  // Undead = 3
    writeDouble(target, 7, 4000.0);
    writeDouble(target, 8, 2.0);

    const encounter = new ProtoWriter();
    writeDouble(encounter, ENC_DURATION, 300.0);
    writeDouble(encounter, ENC_DURATION_VARIATION, 5.0);
    writeDouble(encounter, ENC_EXECUTE_PROPORTION, 0.2);
    encounter.fieldMessage(ENC_TARGETS, target);

    const simOptions = new ProtoWriter();
    simOptions.fieldVarint(SIMOPT_ITERATIONS, iterations || 3000);
    simOptions.fieldVarint(SIMOPT_RANDOM_SEED, randomSeed || Math.floor(Math.random() * 0x7fffffff));

    const rsr = new ProtoWriter();
    rsr.fieldMessage(RSR_RAID, raid);
    rsr.fieldMessage(RSR_ENCOUNTER, encounter);
    rsr.fieldMessage(RSR_SIM_OPTIONS, simOptions);

    return rsr.finish();
}

// ─── Build ComputeStatsRequest ───────────────────────────────────────────────
// ComputeStatsRequest { raid = 1 }
// Reuses the same Raid message as buildRaidSimRequest but without Encounter/SimOptions

function buildComputeStatsRequest(gearSlots, specKey) {
    // Equipment is the same for all specs
    const equipSpec = new ProtoWriter();
    for (const slot of gearSlots) {
        const itemSpec = new ProtoWriter();
        itemSpec.fieldVarint(ITEM_ID, slot.id);
        if (slot.enchant) itemSpec.fieldVarint(ITEM_ENCHANT, slot.enchant);
        for (const gem of (slot.gems || [])) itemSpec.fieldVarint(ITEM_GEMS, gem);
        equipSpec.fieldMessage(EQUIP_ITEMS, itemSpec);
    }

    let player;

    if (specKey === 'Priest-Shadow') {
        // ── Shadow Priest spec for ComputeStats ──
        const rotation = new ProtoWriter();
        rotation.fieldVarint(SPR_ROTATION_TYPE, SP_ROTATION_IDEAL);
        rotation.fieldVarint(SPR_USE_DEV_PLAGUE, 1);
        rotation.fieldVarint(SPR_PRECAST_VT, 1);
        writeDouble(rotation, SPR_LATENCY, 50.0);

        const talents = new ProtoWriter();
        talents.fieldVarint(PT_INNER_FOCUS, 1);
        talents.fieldVarint(PT_MEDITATION, 3);
        talents.fieldVarint(PT_SHADOW_AFFINITY, 3);
        talents.fieldVarint(PT_IMP_SHADOW_WORD_PAIN, 2);
        talents.fieldVarint(PT_SHADOW_FOCUS, 5);
        talents.fieldVarint(PT_IMP_MIND_BLAST, 5);
        talents.fieldVarint(PT_MIND_FLAY, 1);
        talents.fieldVarint(PT_SHADOW_WEAVING, 5);
        talents.fieldVarint(PT_VAMPIRIC_EMBRACE, 1);
        talents.fieldVarint(PT_FOCUSED_MIND, 3);
        talents.fieldVarint(PT_DARKNESS, 5);
        talents.fieldVarint(PT_SHADOWFORM, 1);
        talents.fieldVarint(PT_SHADOW_POWER, 4);
        talents.fieldVarint(PT_MISERY, 5);
        talents.fieldVarint(PT_VAMPIRIC_TOUCH, 1);

        const options = new ProtoWriter();
        options.fieldVarint(SPO_USE_SHADOWFIEND, 1);

        const spSpec = new ProtoWriter();
        spSpec.fieldMessage(SP_ROTATION, rotation);
        spSpec.fieldMessage(SP_TALENTS, talents);
        spSpec.fieldMessage(SP_OPTIONS, options);

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_SP_FLASK, 3);           // FlaskOfPureDeath = 3
        consumes.fieldVarint(CONS_SP_FOOD, 1);            // FoodBlackenedBasilisk = 1
        consumes.fieldVarint(CONS_SP_DEFAULT_POTION, 2);  // SuperManaPotion = 2
        consumes.fieldVarint(CONS_SP_MH_IMBUE, 4);        // WeaponImbueSuperiorWizardOil = 4

        const indBuffs = new ProtoWriter();
        indBuffs.fieldVarint(IB_BLESSING_OF_KINGS, 1);
        indBuffs.fieldVarint(IB_BLESSING_OF_WISDOM, 2);
        indBuffs.fieldVarint(IB_BLESSING_OF_SALVATION, 1);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Shadow Priest'));
        player.fieldVarint(PLAYER_RACE, RACE_UNDEAD);
        player.fieldVarint(PLAYER_CLASS, CLASS_PRIEST);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_BUFFS, indBuffs);
        player.fieldMessage(PLAYER_SHADOW_PRIEST, spSpec);

    } else {
        // ── Fury Warrior spec for ComputeStats (default) ──
        const rotation = new ProtoWriter();
        rotation.fieldVarint(WR_USE_HAMSTRING, 1);
        rotation.fieldVarint(WR_SUNDER_ARMOR, 2);
        rotation.fieldVarint(WR_USE_HS_DURING_EXECUTE, 1);
        rotation.fieldVarint(WR_USE_BT_DURING_EXECUTE, 1);
        rotation.fieldVarint(WR_USE_WW_DURING_EXECUTE, 1);
        writeDouble(rotation, WR_HS_RAGE_THRESHOLD, 60.0);
        writeDouble(rotation, WR_RAMPAGE_CD_THRESHOLD, 5.0);

        const furyTalents = new ProtoWriter();
        furyTalents.fieldVarint(WT_IMPROVED_HEROIC_STRIKE, 3);
        furyTalents.fieldVarint(WT_CRUELTY, 5);
        furyTalents.fieldVarint(WT_UNBRIDLED_WRATH, 5);
        furyTalents.fieldVarint(WT_COMMANDING_PRESENCE, 1);
        furyTalents.fieldVarint(WT_IMPROVED_EXECUTE, 3);
        furyTalents.fieldVarint(WT_WEAPON_MASTERY, 2);
        furyTalents.fieldVarint(WT_FLURRY, 5);
        furyTalents.fieldVarint(WT_PRECISION, 3);
        furyTalents.fieldVarint(WT_BLOODTHIRST, 1);
        furyTalents.fieldVarint(WT_IMPROVED_BERSERKER_STANCE, 5);
        furyTalents.fieldVarint(WT_RAMPAGE, 1);

        const options = new ProtoWriter();
        writeDouble(options, WO_STARTING_RAGE, 0.0);
        options.fieldVarint(WO_USE_RECKLESSNESS, 1);
        options.fieldVarint(WO_SHOUT, 1);
        options.fieldVarint(WO_PRECAST_SHOUT, 1);

        const warriorSpec = new ProtoWriter();
        warriorSpec.fieldMessage(WARRIOR_ROTATION, rotation);
        warriorSpec.fieldMessage(WARRIOR_TALENTS, furyTalents);
        warriorSpec.fieldMessage(WARRIOR_OPTIONS, options);

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_FLASK, 4);
        consumes.fieldVarint(CONS_FOOD, 4);
        consumes.fieldVarint(CONS_DEFAULT_POTION, 3);
        consumes.fieldVarint(CONS_MH_IMBUE, 1);
        consumes.fieldVarint(CONS_OH_IMBUE, 1);

        const indBuffs = new ProtoWriter();
        indBuffs.fieldVarint(IB_BLESSING_OF_KINGS, 1);
        indBuffs.fieldVarint(IB_BLESSING_OF_MIGHT, 2);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Fury Warrior'));
        player.fieldVarint(PLAYER_RACE, RACE_ORC);
        player.fieldVarint(PLAYER_CLASS, CLASS_WARRIOR);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_BUFFS, indBuffs);
        player.fieldMessage(PLAYER_WARRIOR, warriorSpec);
    }

    const party = new ProtoWriter();
    party.fieldMessage(PARTY_PLAYERS, player);

    const raidBuffs = new ProtoWriter();
    if (specKey === 'Priest-Shadow') {
        raidBuffs.fieldVarint(RB_ARCANE_BRILLIANCE, 1);
        raidBuffs.fieldVarint(RB_DIVINE_SPIRIT, 2);
    }
    raidBuffs.fieldVarint(RB_GIFT_OF_THE_WILD, 2);

    const debuffs = new ProtoWriter();
    if (specKey === 'Priest-Shadow') {
        debuffs.fieldVarint(DB_JUDGEMENT_OF_WISDOM, 1); // field 1
        debuffs.fieldVarint(DB_MISERY, 1);              // field 3
        debuffs.fieldVarint(DB_CURSE_OF_ELEMENTS, 1);   // field 4
        debuffs.fieldVarint(DB_FAERIE_FIRE, 2);         // field 10
        debuffs.fieldVarint(DB_SHADOW_WEAVING, 1);      // field 18
    } else {
        debuffs.fieldVarint(DB_SUNDER_ARMOR, 1);
        debuffs.fieldVarint(DB_FAERIE_FIRE, 2);
        debuffs.fieldVarint(DB_CURSE_OF_RECKLESSNESS, 1);
    }

    const raid = new ProtoWriter();
    raid.fieldMessage(RAID_PARTIES, party);
    raid.fieldMessage(RAID_BUFFS, raidBuffs);
    raid.fieldMessage(RAID_DEBUFFS, debuffs);

    // ComputeStatsRequest { raid = 1 }
    const req = new ProtoWriter();
    req.fieldMessage(1, raid);
    return req.finish();
}

// ─── Stat enum index → name/label (från common.proto Stat enum) ─────────────
// StatStrength=0, StatAgility=1, StatStamina=2, StatIntellect=3, StatSpirit=4,
// StatAttackPower=18, StatMeleeHit=19, StatMeleeCrit=20, StatMeleeHaste=21,
// StatArmorPenetration=22, StatExpertise=23, StatHealth=35
const STAT_LABELS = {
     0: { label: 'Strength',      fmt: v => Math.round(v) },
     1: { label: 'Agility',       fmt: v => Math.round(v) },
     2: { label: 'Stamina',       fmt: v => Math.round(v) },
    18: { label: 'Attack Power',  fmt: v => Math.round(v) },
    19: { label: 'Hit',           fmt: v => `${Math.round(v)} (${(v/15.76).toFixed(2)}%)` },
    20: { label: 'Crit',          fmt: v => `${Math.round(v)} (${(v/22.08).toFixed(2)}%)` },
    21: { label: 'Haste',         fmt: v => `${Math.round(v)} (${(v/15.76).toFixed(2)}%)` },
    22: { label: 'Armor Pen',     fmt: v => Math.round(v) },
    23: { label: 'Expertise',     fmt: v => `${Math.round(v)} (${Math.floor(v/3.9375)})` },
    35: { label: 'Health',        fmt: v => Math.round(v) },
};
// Ordning att visa dem i
const STAT_ORDER = [35, 0, 1, 2, 18, 19, 20, 21, 22, 23];

// ─── Parse ComputeStatsResult ────────────────────────────────────────────────
// ComputeStatsResult { raid_stats=1 { parties=1 { players=1 {
//   final_stats=2 (repeated double)
// }}}, error_result=2 }
function parseComputeStatsResult(bytes) {
    let finalStats = null;
    let error = null;

    const r = new ProtoReader(bytes);
    r.readFields((field, wireType, r) => {
        if (field === 2 && wireType === 2) {
            // error_result
            error = new TextDecoder().decode(r._readBytes());
        } else if (field === 1 && wireType === 2) {
            // raid_stats = RaidStats { parties=1 }
            const raidStats = new ProtoReader(r._readBytes());
            raidStats.readFields((f2, wt2, r2) => {
                if (f2 === 1 && wt2 === 2) {
                    // PartyStats { players=1 }
                    const partyStats = new ProtoReader(r2._readBytes());
                    partyStats.readFields((f3, wt3, r3) => {
                        if (f3 === 1 && wt3 === 2) {
                            // PlayerStats { final_stats=2 (packed repeated double) }
                            const playerStats = new ProtoReader(r3._readBytes());
                            playerStats.readFields((f4, wt4, r4) => {
                                if (f4 === 2 && wt4 === 2) {
                                    // packed repeated double
                                    const packed = r4._readBytes();
                                    finalStats = [];
                                    for (let i = 0; i < packed.length; i += 8) {
                                        const buf = packed.buffer.slice(
                                            packed.byteOffset + i,
                                            packed.byteOffset + i + 8
                                        );
                                        finalStats.push(new DataView(buf).getFloat64(0, true));
                                    }
                                } else r4._skip(wt4);
                            });
                        } else r3._skip(wt3);
                    });
                } else r2._skip(wt2);
            });
        } else r._skip(wireType);
    });

    if (error) throw new Error('ComputeStats error: ' + error);
    return finalStats || [];
}

// ─── Parse ProgressMetrics from binary protobuf ─────────────────────────────
// We only need: completed_iterations(1), total_iterations(2), dps(5),
//               final_raid_result(6)
// RaidSimResult → raid_metrics(1) → dps(1) → avg(1), stdev(2)

class ProtoReader {
    constructor(bytes) {
        this._bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        this._pos = 0;
    }

    _readVarint() {
        let result = 0, shift = 0;
        while (this._pos < this._bytes.length) {
            const b = this._bytes[this._pos++];
            result |= (b & 0x7f) << shift;
            shift += 7;
            if (!(b & 0x80)) break;
        }
        return result >>> 0;
    }

    _readFixed64() {
        const lo = this._readFixed32();
        const hi = this._readFixed32();
        return lo + hi * 4294967296;
    }

    _readFixed32() {
        let v = 0;
        v |= this._bytes[this._pos++];
        v |= this._bytes[this._pos++] << 8;
        v |= this._bytes[this._pos++] << 16;
        v |= this._bytes[this._pos++] << 24;
        return v >>> 0;
    }

    _readDouble() {
        const buf = this._bytes.buffer.slice(
            this._bytes.byteOffset + this._pos,
            this._bytes.byteOffset + this._pos + 8
        );
        this._pos += 8;
        return new DataView(buf).getFloat64(0, true);
    }

    _readBytes() {
        const len = this._readVarint();
        const bytes = this._bytes.slice(this._pos, this._pos + len);
        this._pos += len;
        return bytes;
    }

    _skip(wireType) {
        if (wireType === 0) this._readVarint();
        else if (wireType === 1) { this._pos += 8; }
        else if (wireType === 2) { const len = this._readVarint(); this._pos += len; }
        else if (wireType === 5) { this._pos += 4; }
    }

    readFields(handler) {
        while (this._pos < this._bytes.length) {
            const tag      = this._readVarint();
            const field    = tag >>> 3;
            const wireType = tag & 0x7;
            handler(field, wireType, this);
        }
    }
}

function parseProgressMetrics(bytes) {
    const result = { completedIterations: 0, totalIterations: 0, dps: 0, done: false, finalDps: null };
    const r = new ProtoReader(bytes);
    r.readFields((field, wireType, r) => {
        if (field === 1 && wireType === 0) result.completedIterations = r._readVarint();
        else if (field === 2 && wireType === 0) result.totalIterations = r._readVarint();
        else if (field === 5 && wireType === 1) result.dps = r._readDouble();
        else if (field === 6 && wireType === 2) {
            // final_raid_result = RaidSimResult
            result.done = true;
            result.finalDps = parseRaidSimResult(r._readBytes());
        } else r._skip(wireType);
    });
    return result;
}

function parseRaidSimResult(bytes) {
    // RaidSimResult.raid_metrics (field 1) → RaidMetrics.dps (field 1) → DistributionMetrics
    let dps = { avg: 0, stdev: 0 };
    const r = new ProtoReader(bytes);
    r.readFields((field, wireType, r) => {
        if (field === 5 && wireType === 2) {
            // error_result string
            const errBytes = r._readBytes();
            const err = new TextDecoder().decode(errBytes);
            if (err) throw new Error('Sim error: ' + err);
        } else if (field === 1 && wireType === 2) {
            // raid_metrics = RaidMetrics
            const raidMetrics = r._readBytes();
            dps = parseRaidMetrics(raidMetrics);
        } else r._skip(wireType);
    });
    return dps;
}

function parseRaidMetrics(bytes) {
    let dps = { avg: 0, stdev: 0 };
    const r = new ProtoReader(bytes);
    r.readFields((field, wireType, r) => {
        if (field === 1 && wireType === 2) {
            // dps = DistributionMetrics
            dps = parseDistributionMetrics(r._readBytes());
        } else r._skip(wireType);
    });
    return dps;
}

function parseDistributionMetrics(bytes) {
    const result = { avg: 0, stdev: 0 };
    const r = new ProtoReader(bytes);
    r.readFields((field, wireType, r) => {
        if (field === 1 && wireType === 1) result.avg   = r._readDouble();
        else if (field === 2 && wireType === 1) result.stdev = r._readDouble();
        else r._skip(wireType);
    });
    return result;
}

// ─── WowSimBridge class ──────────────────────────────────────────────────────

class WowSimBridge {
    constructor(workerUrl) {
        this.worker = new Worker(workerUrl);
        this.ready  = false;
        this.onReady  = null;
        this.onError  = null;
        this._pending = {};  // taskId → { resolve, reject, onProgress }
        this._taskCounter = 0;

        this.worker.onmessage = (e) => {
            const { msg, id, outputData } = e.data;

            if (msg === 'ready') {
                // WASM loaded — send setID
                this.worker.postMessage({ msg: 'setID', id: '1' });
                return;
            }
            if (msg === 'idconfirm') {
                this.ready = true;
                if (this.onReady) this.onReady();
                return;
            }

            // Progress update
            if (msg === 'progress' && id) {
                const baseId = id.replace('progress', '');
                const task = this._pending[baseId];
                if (task && outputData) {
                    try {
                        const progress = parseProgressMetrics(outputData);
                        if (task.onProgress) task.onProgress(progress);
                        if (progress.done && progress.finalDps) {
                            delete this._pending[baseId];
                            task.resolve(progress.finalDps);
                        }
                    } catch (err) {
                        delete this._pending[baseId];
                        task.reject(err);
                    }
                }
                return;
            }

            // Final result (non-async path — computeStats, gearList etc.)
            if (this._pending[id]) {
                const task = this._pending[id];
                delete this._pending[id];
                task.resolve(outputData);
            }
        };

        this.worker.onerror = (e) => {
            console.error('Worker error:', e);
            if (this.onError) this.onError(e.message);
        };
    }

    _makeTaskId() {
        return 'task_' + (++this._taskCounter) + '_' + Date.now();
    }

    runFuryWarrior(gearSlots, onProgress, iterations = 3000) {
        if (!this.ready) return Promise.reject(new Error('WASM not ready yet'));

        const request = buildRaidSimRequest(gearSlots, iterations, Math.floor(Math.random() * 0x7fffffff));
        const id      = this._makeTaskId();

        return new Promise((resolve, reject) => {
            this._pending[id] = { resolve, reject, onProgress };
            this.worker.postMessage({
                msg:       'raidSimAsync',
                id:        id,
                inputData: request,
            });
        });
    }

    runArmsWarrior(gearSlots, onProgress, iterations = 3000) {
        if (!this.ready) return Promise.reject(new Error('WASM not ready yet'));

        const request = buildArmsSimRequest(gearSlots, iterations, Math.floor(Math.random() * 0x7fffffff));
        const id      = this._makeTaskId();

        return new Promise((resolve, reject) => {
            this._pending[id] = { resolve, reject, onProgress };
            this.worker.postMessage({
                msg:       'raidSimAsync',
                id:        id,
                inputData: request,
            });
        });
    }

    runShadowPriest(gearSlots, onProgress, iterations = 3000) {
        if (!this.ready) return Promise.reject(new Error('WASM not ready yet'));

        const request = buildShadowPriestSimRequest(gearSlots, iterations, Math.floor(Math.random() * 0x7fffffff));
        const id      = this._makeTaskId();

        return new Promise((resolve, reject) => {
            this._pending[id] = { resolve, reject, onProgress };
            this.worker.postMessage({
                msg:       'raidSimAsync',
                id:        id,
                inputData: request,
            });
        });
    }

    // Synkront stats-anrop — returnerar Promise<float[]> (final_stats array)
    computeStats(gearSlots, specKey) {
        if (!this.ready) return Promise.reject(new Error('WASM not ready yet'));

        const request = buildComputeStatsRequest(gearSlots, specKey);
        const id      = this._makeTaskId();

        return new Promise((resolve, reject) => {
            this._pending[id] = {
                resolve: (bytes) => {
                    try { resolve(parseComputeStatsResult(bytes)); }
                    catch(e) { reject(e); }
                },
                reject,
                onProgress: null,
            };
            this.worker.postMessage({
                msg:       'computeStats',
                id:        id,
                inputData: request,
            });
        });
    }
}
