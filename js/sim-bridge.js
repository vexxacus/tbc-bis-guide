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

    // Like fieldMessage but ALWAYS writes the field tag+length even for empty messages.
    // Required for proto oneof spec sub-messages so Go decodes a non-nil pointer.
    fieldMessageRequired(field, writer) {
        const bytes = writer.finish();
        this._tag(field, 2);
        this._varint(bytes.length);
        for (const b of bytes) this._buf.push(b);
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

// WarriorTalents — Protection tree fields (from proto/warrior.proto)
const WT_TACTICAL_MASTERY            = 37;  // 3
const WT_ANTICIPATION                = 47;  // 5 → +5 defense skill
const WT_SHIELD_SPECIALIZATION       = 48;  // 5 → +5% block chance
const WT_TOUGHNESS                   = 49;  // 5 → +10% armor
const WT_DEFIANCE                    = 38;  // 3 → +15% threat
const WT_IMPROVED_SUNDER_ARMOR       = 39;  // 3
const WT_SHIELD_SLAM                 = 41;  // bool true
const WT_ONE_HAND_WEAPON_SPEC        = 40;  // 5
const WT_FOCUSED_RAGE                = 42;  // 3
const WT_VITALITY                    = 43;  // 5 → +4% str/stam
const WT_DEVASTATE                   = 44;  // bool true

// WarriorOptions fields
const WO_STARTING_RAGE     = 1;
const WO_USE_RECKLESSNESS  = 2;
const WO_SHOUT             = 3;  // enum: 1 = Battle Shout
const WO_PRECAST_SHOUT     = 4;

// ─── DruidTalents fields (from proto/druid.proto) ─────────────────────────
// Feral Combat tree — key talents for tank/cat
const DT_FEROCITY                  = 17;  // 5 → -5 energy/rage cost
const DT_FERAL_AGGRESSION          = 18;  // 2 → improved demo roar
const DT_FERAL_INSTINCT            = 41;  // 3 → +15% threat in bear form
const DT_THICK_HIDE                = 42;  // 3 → +10% armor in bear form
const DT_SHARPENED_CLAWS           = 19;  // 3 → +6% crit chance
const DT_PREDATORY_STRIKES         = 21;  // 3
const DT_PRIMAL_FURY               = 22;  // 2 → extra combo point on crit
const DT_HEART_OF_THE_WILD         = 25;  // 5 → +20% stam in bear form
const DT_SURVIVAL_OF_THE_FITTEST   = 26;  // 3 → -6% crit chance taken (CRIT IMMUNITY)
const DT_LEADER_OF_THE_PACK        = 27;  // bool → aura (+5% crit)
const DT_MANGLE                    = 30;  // bool → key ability

// DruidTalents — Restoration tree
const DT_IMP_MARK_OF_THE_WILD     = 31;  // 0-5
const DT_FUROR                     = 32;  // 0-5
const DT_NATURALIST                = 33;  // 0-5 → -10% GHT cast time
const DT_NATURAL_SHAPESHIFTER      = 34;  // 0-3
const DT_INTENSITY                 = 35;  // 0-3 → mana regen in casting
const DT_OMEN_OF_CLARITY           = 36;  // bool → clearcasting
const DT_NATURES_SWIFTNESS         = 37;  // bool → instant cast
const DT_LIVING_SPIRIT             = 38;  // 0-3 → +15% spirit
const DT_NATURAL_PERFECTION        = 39;  // 0-3 → +3% spell crit

// ─── RogueTalents fields (from proto/rogue.proto) ────────────────────────────
// Assassination tree
const RT_MALICE                    = 2;   // 5 → +5% crit
const RT_RUTHLESSNESS              = 3;   // 3 → CP on finishing moves
const RT_MURDER                    = 4;   // 2 → +4% dmg vs below 35%
const RT_LETHALITY                 = 8;   // 5 → +30% crit bonus dmg
const RT_RELENTLESS_STRIKES        = 6;   // bool → energy on finishers
const RT_SEAL_FATE                 = 13;  // 5 → CP on extra crit
// Combat tree
const RT_IMPROVED_SINISTER_STRIKE  = 18;  // 2 → -2 energy
const RT_PRECISION                 = 20;  // 5 → +5% hit
const RT_DUAL_WIELD_SPEC           = 22;  // 5 → +5% OH dmg
const RT_BLADE_FLURRY              = 24;  // bool
const RT_SWORD_SPEC                = 25;  // 5 → extra swings
const RT_WEAPON_EXPERTISE          = 27;  // 2 → +10 weapon skill (expertise)
const RT_AGGRESSION                = 28;  // 3 → +6% SS/Eviscerate dmg
const RT_VITALITY                  = 29;  // 2 → +8% AP/energy regen
const RT_ADRENALINE_RUSH           = 30;  // bool
const RT_COMBAT_POTENCY            = 31;  // 5 → +15% OH proc energy
const RT_SURPRISE_ATTACKS          = 32;  // bool → removes dodge on finisher

// ─── PaladinTalents fields (from proto/paladin.proto) ────────────────────────
// Retribution tree
const PAL_CONVICTION                = 23;  // 5 → +5% crit
const PAL_SEAL_OF_COMMAND           = 24;  // bool
const PAL_CRUSADE                   = 25;  // 3 → +3% dmg vs undead/humanoid/demon
const PAL_TWO_HAND_SPEC             = 26;  // 5 → +10% 2H dmg
const PAL_VENGEANCE                 = 29;  // 5 → stacking dmg bonus after crits
const PAL_SANCTIFIED_SEALS          = 31;  // 5 → +5% crit chance
const PAL_FANATICISM                = 32;  // 5 → +15% crit / -30% threat
const PAL_CRUSADER_STRIKE           = 33;  // bool → key ability
const PAL_IMPROVED_JUDGEMENT        = 20;  // 2 → -1s cooldown
const PAL_BENEDICTION               = 19;  // 5 → reduced mana cost
// Protection tree — for prot paladin
const PAL_REDOUBT                   = 36;  // 5 → block on being crit
const PAL_PRECISION                 = 11;  // 3 → +3% hit
const PAL_TOUGHNESS                 = 37;  // 5 → +10% armor
const PAL_IMPROVED_RF               = 38;  // 3 → improved Righteous Fury threat
const PAL_SHIELD_SPEC               = 39;  // 3 → proc on block
const PAL_ANTICIPATION              = 40;  // 5 → +20 defense skill
const PAL_BLESSING_OF_SANCTUARY     = 42;  // bool → block/parry rage
const PAL_SACRED_DUTY               = 14;  // 2 → +6% stam, reduced DS cooldown
const PAL_ONE_HAND_SPEC             = 15;  // 5 → +10% 1H dmg
const PAL_HOLY_SHIELD               = 44;  // bool → block ability
const PAL_ARDENT_DEFENDER           = 45;  // 3 → survive killing blows
const PAL_COMBAT_EXPERTISE          = 16;  // 5 → +10 expertise / +6% stam
const PAL_AVENGERS_SHIELD           = 17;  // bool → pull ability

// PaladinTalents — Holy tree
const PAL_DIVINE_STRENGTH           = 1;   // 0-5 → +10% str
const PAL_DIVINE_INTELLECT          = 2;   // 0-5 → +10% int
const PAL_ILLUMINATION              = 34;  // 0-5 → mana return on crit
const PAL_IMP_BLESSING_OF_WISDOM    = 4;   // 0-2 → better BoW
const PAL_DIVINE_FAVOR              = 5;   // bool → guaranteed crit
const PAL_HOLY_POWER                = 7;   // 0-5 → +5% holy crit
const PAL_HOLY_GUIDANCE             = 9;   // 0-5 → 35% int → spell power
const PAL_DIVINE_ILLUMINATION       = 10;  // bool → 50% mana cost reduction

// ─── ShamanTalents fields (from proto/shaman.proto) ──────────────────────────
// Enhancement tree
const ST_THUNDERING_STRIKES         = 16;  // 5 → +5% melee crit
const ST_ENHANCING_TOTEMS           = 17;  // 2 → stronger SoE/GoA
const ST_SHAMANISTIC_FOCUS          = 18;  // bool → reduced cost on hit
const ST_FLURRY                     = 19;  // 5 → +30% attack speed on crit
const ST_ELEMENTAL_WEAPONS          = 21;  // 3 → +30% weapon imbue
const ST_MENTAL_QUICKNESS           = 22;  // 3 → +30% SP from AP
const ST_WEAPON_MASTERY             = 23;  // 5 → +10 weapon skill (expertise)
const ST_DUAL_WIELD_SPEC            = 24;  // 5 → +5% OH hit / +5% OH dmg
const ST_UNLEASHED_RAGE             = 25;  // 5 → +10% AP aura
const ST_STORMSTRIKE                = 34;  // bool → key ability
const ST_SPIRIT_WEAPONS             = 36;  // bool → -30% threat
const ST_SHAMANISTIC_RAGE           = 35;  // bool → mana return on hit
// Restoration dip for Enhancement
const ST_NATURES_GUIDANCE           = 27;  // 3 → +3% hit/spell hit
// Restoration tree — for Resto Shaman
const ST_TOTEMIC_FOCUS              = 26;  // 0-5 → reduced totem cost
const ST_RESTORATIVE_TOTEMS         = 28;  // 0-5 → stronger mana spring
const ST_TIDAL_MASTERY              = 29;  // 0-5 → +5% heal/spell crit
const ST_NATURES_SWIFTNESS_SHAM     = 30;  // bool → instant cast
const ST_MANA_TIDE_TOTEM            = 31;  // bool → mana regen totem
const ST_NATURES_BLESSING           = 32;  // 0-3 → +30% spell power from int
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

// PriestTalents fields — verified against proto/priest.proto field numbers
// Discipline tree
const PT_INNER_FOCUS              = 2;   // bool
const PT_MEDITATION               = 3;   // 0-3
// Holy tree (unused for shadow)
// Shadow tree
const PT_IMP_SHADOW_WORD_PAIN     = 18;  // 0-2
const PT_SHADOW_FOCUS             = 19;  // 0-5
const PT_IMP_MIND_BLAST           = 20;  // 0-5
const PT_MIND_FLAY                = 21;  // bool
const PT_SHADOW_WEAVING           = 22;  // 0-5
const PT_VAMPIRIC_EMBRACE         = 23;  // bool
const PT_FOCUSED_MIND             = 25;  // 0-3
const PT_DARKNESS                 = 26;  // 0-5
const PT_SHADOWFORM               = 27;  // bool
const PT_SHADOW_POWER             = 28;  // 0-5
const PT_MISERY                   = 29;  // 0-5
const PT_VAMPIRIC_TOUCH           = 30;  // bool
const PT_SHADOW_AFFINITY          = 32;  // 0-3

// PriestTalents — Discipline tree (additional fields for Holy spec)
const PT_MENTAL_AGILITY           = 4;   // 0-5
const PT_MENTAL_STRENGTH          = 5;   // 0-5 → +10% max mana
const PT_DIVINE_SPIRIT            = 6;   // bool
const PT_IMPROVED_DIVINE_SPIRIT   = 7;   // 0-2 → 10% spirit → spell power
const PT_FOCUSED_POWER            = 8;   // 0-2
const PT_FORCE_OF_WILL            = 9;   // 0-5
const PT_POWER_INFUSION           = 10;  // bool
const PT_ENLIGHTENMENT            = 11;  // 0-3 → +6% int/stam/spirit

// PriestTalents — Holy tree
const PT_HOLY_SPECIALIZATION      = 12;  // 0-5 → +5% holy crit
const PT_DIVINE_FURY              = 13;  // 0-5 → faster GHeal/Smite
const PT_SEARING_LIGHT            = 15;  // 0-2
const PT_SPIRITUAL_GUIDANCE       = 16;  // 0-5 → 25% spirit → spell power
const PT_SURGE_OF_LIGHT           = 17;  // 0-2
const PT_SPIRIT_OF_REDEMPTION     = 33;  // bool → +5% spirit

// MageTalents fields — verified against proto/mage.proto
const MT_ARCANE_SUBTLETY      = 1;
const MT_ARCANE_CONCENTRATION = 4;   // 0-5
const MT_ARCANE_MEDITATION    = 6;   // 0-3
const MT_PRESENCE_OF_MIND     = 7;   // bool
const MT_ARCANE_MIND          = 8;   // 0-5
const MT_ARCANE_INSTABILITY   = 9;   // 0-3
const MT_ARCANE_POTENCY       = 10;  // 0-2
const MT_ARCANE_POWER         = 12;  // bool
const MT_SPELL_POWER          = 13;  // 0-5
const MT_MIND_MASTERY         = 14;  // 0-5
const MT_IMPROVED_FIREBALL    = 15;  // 0-5
const MT_IGNITE               = 16;  // 0-5
const MT_IMPROVED_SCORCH      = 21;  // 0-3
const MT_MASTER_OF_ELEMENTS   = 22;  // 0-3
const MT_PLAYING_WITH_FIRE    = 23;  // 0-3
const MT_CRITICAL_MASS        = 24;  // 0-3
const MT_FIRE_POWER           = 26;  // 0-5
const MT_PYROMANIAC           = 27;  // 0-3
const MT_COMBUSTION           = 28;  // bool
const MT_MOLTEN_FURY          = 29;  // 0-2
const MT_EMPOWERED_FIREBALL   = 30;  // 0-5
const MT_IMPROVED_FROSTBOLT   = 32;  // 0-5
const MT_ELEMENTAL_PRECISION  = 33;  // 0-3
const MT_ICE_SHARDS           = 34;  // 0-5
const MT_PIERCING_ICE         = 36;  // 0-3
const MT_ICY_VEINS            = 37;  // bool
const MT_FROST_CHANNELING     = 38;  // 0-3
const MT_SHATTER              = 39;  // 0-5
const MT_WINTERS_CHILL        = 43;  // 0-5
const MT_ARCTIC_WINDS         = 44;  // 0-5
const MT_EMPOWERED_FROSTBOLT  = 45;  // 0-5
const MT_SUMMON_WATER_ELEMENTAL = 46; // bool
// Mage spec/rotation field numbers
const MAGE_ROTATION = 1;
const MAGE_TALENTS  = 2;
const MAGE_OPTIONS  = 3;
const MO_ARMOR      = 1;  // 0=NoArmor, 1=MageArmor, 2=MoltenArmor

// WarlockTalents fields — verified against proto/warlock.proto
const WLT_SUPPRESSION         = 1;
const WLT_IMPROVED_CORRUPTION = 2;   // 0-5
const WLT_SOUL_SIPHON         = 4;   // 0-2
const WLT_NIGHTFALL           = 7;   // 0-2
const WLT_EMPOWERED_CORRUPTION = 8;  // 0-3
const WLT_SIPHON_LIFE         = 9;   // bool
const WLT_SHADOW_MASTERY      = 10;  // 0-5
const WLT_CONTAGION           = 11;  // 0-5
const WLT_DARK_PACT           = 12;  // bool
const WLT_MALEDICTION         = 13;  // 0-3
const WLT_UNSTABLE_AFFLICTION = 14;  // bool
const WLT_DEMONIC_EMBRACE     = 16;  // 0-5
const WLT_DEMONIC_TACTICS     = 30;  // 0-5
const WLT_SUMMON_FELGUARD     = 31;  // bool
const WLT_IMPROVED_SHADOW_BOLT = 32; // 0-5
const WLT_CATACLYSM           = 33;  // 0-5
const WLT_BANE                = 34;  // 0-5
const WLT_DEVASTATION         = 37;  // 0-5
const WLT_RUIN                = 41;  // bool
const WLT_EMBERSTORM          = 42;  // 0-5
const WLT_SOUL_LEECH          = 45;  // 0-4
const WLT_SHADOW_AND_FLAME    = 46;  // 0-5
// Warlock spec/rotation/options field numbers
const WARLOCK_ROTATION = 1;
const WARLOCK_TALENTS  = 2;
const WARLOCK_OPTIONS  = 3;
const WLO_ARMOR        = 1;  // 1=FelArmor, 2=DemonArmor
const WLO_SUMMON       = 2;  // 1=Imp, 4=Felhound, 5=Felguard
const WLO_SACRIFICE    = 3;  // bool

// HunterTalents fields — verified against proto/hunter.proto
const HT_IMPROVED_ASPECT_OF_HAWK = 1;
const HT_FOCUSED_FIRE        = 3;
const HT_UNLEASHED_FURY      = 4;   // 0-5
const HT_FEROCITY            = 5;   // 0-5
const HT_BESTIAL_DISCIPLINE  = 6;   // 0-2
const HT_FRENZY              = 7;   // 0-5
const HT_FEROCIOUS_INSPIRATION = 8; // 0-3
const HT_BESTIAL_WRATH       = 9;   // bool
const HT_SERPENTS_SWIFTNESS  = 10;  // 0-5
const HT_THE_BEAST_WITHIN    = 11;  // bool
const HT_LETHAL_SHOTS        = 12;  // 0-5
const HT_IMPROVED_HUNTERS_MARK = 13; // 0-5
const HT_EFFICIENCY          = 14;  // 0-5
const HT_GO_FOR_THE_THROAT   = 15;  // 0-2
const HT_AIMED_SHOT          = 17;  // bool
const HT_MORTAL_SHOTS        = 20;  // 0-5
const HT_SCATTER_SHOT        = 21;  // bool
const HT_BARRAGE             = 22;  // 0-3
const HT_RANGED_WEAPON_SPEC  = 24;  // 0-5
const HT_CAREFUL_AIM         = 25;  // 0-3
const HT_TRUESHOT_AURA       = 26;  // bool
const HT_MASTER_MARKSMAN     = 28;  // 0-5
const HT_LIGHTNING_REFLEXES  = 40;  // 0-5
const HT_THRILL_OF_THE_HUNT  = 41;  // 0-3
const HT_EXPOSE_WEAKNESS     = 42;  // 0-3
const HT_MASTER_TACTICIAN    = 43;  // 0-5
const HT_READINESS           = 44;  // bool
// Hunter spec/rotation/options field numbers
const HUNTER_ROTATION = 1;
const HUNTER_TALENTS  = 2;
const HUNTER_OPTIONS  = 3;
const HRO_QUIVER_BONUS = 1;  // 6=Speed15
const HRO_AMMO         = 2;  // 6=BlackflightArrow
const HRO_PET_TYPE     = 3;  // 1=Ravager, 2=Cat, 3=Raptor
const HRO_PET_UPTIME   = 4;
const HR_USE_MULTI_SHOT  = 1;
const HR_USE_ARCANE_SHOT = 2;
const HR_STING           = 5;  // 2=SerpentSting
const HR_WEAVE           = 11; // 3=WeaveFull

// ElementalShamanTalents fields — verified against proto/shaman.proto
const EST_CONVECTION         = 1;   // 0-5
const EST_CONCUSSION         = 2;   // 0-5
const EST_CALL_OF_FLAME      = 3;   // 0-5
const EST_ELEMENTAL_FOCUS    = 4;   // bool
const EST_REVERBERATION      = 5;   // 0-5
const EST_CALL_OF_THUNDER    = 6;   // 0-5
const EST_ELEMENTAL_DEVASTATION = 8; // 0-3
const EST_ELEMENTAL_FURY     = 9;   // bool
const EST_UNRELENTING_STORM  = 10;  // 0-3
const EST_ELEMENTAL_PRECISION = 11; // 0-3
const EST_LIGHTNING_MASTERY  = 12;  // 0-5
const EST_ELEMENTAL_MASTERY  = 13;  // bool
const EST_LIGHTNING_OVERLOAD  = 14; // 0-5
const EST_TOTEM_OF_WRATH     = 33;  // bool
// Elemental Shaman spec field numbers
const ELE_SHAMAN_ROTATION = 1;
const ELE_SHAMAN_TALENTS  = 2;
const ELE_SHAMAN_OPTIONS  = 3;
const ESO_WATER_SHIELD    = 1;  // bool
const ESO_BLOODLUST       = 2;  // bool

// SmitePriest spec message field numbers (proto/priest.proto SmitePriest)
const SMITE_ROTATION = 1;
const SMITE_TALENTS  = 2;
const SMITE_OPTIONS  = 3;
const SMITE_OPT_USE_SHADOWFIEND = 1;  // bool

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

// ─── Additional class/race/spec constants ────────────────────────────────────
// Class enum (from proto/common.proto)
const CLASS_DRUID   = 1;
const CLASS_HUNTER  = 2;
const CLASS_MAGE    = 3;
const CLASS_PALADIN = 4;
// CLASS_PRIEST = 5  (declared above)
const CLASS_ROGUE   = 6;
const CLASS_SHAMAN  = 7;
const CLASS_WARLOCK = 8;
// Race enum (from proto/common.proto)
const RACE_TAUREN    = 8;
const RACE_HUMAN     = 5;
const RACE_NIGHT_ELF = 6;
const RACE_TROLL     = 9;  // Troll10 = 9 (most common for caster shaman/hunter horde)
const RACE_GNOME     = 4;
// Player oneof spec field numbers (from proto/api.proto Player.oneof spec)
const PLAYER_BALANCE_DRUID    = 6;   // balance_druid = 6
const PLAYER_HUNTER           = 7;   // hunter = 7
const PLAYER_MAGE             = 8;   // mage = 8
const PLAYER_RET_PALADIN      = 9;   // retribution_paladin = 9
const PLAYER_SHADOW_PRIEST_SP = 10;  // shadow_priest = 10 (alias to avoid collision)
const PLAYER_PROT_PALADIN     = 25;  // protection_paladin = 25
const PLAYER_PROT_WARRIOR     = 21;  // protection_warrior = 21
const PLAYER_ROGUE            = 11;  // rogue = 11
const PLAYER_ELE_SHAMAN       = 12;  // elemental_shaman = 12
const PLAYER_WARLOCK          = 13;  // warlock = 13
const PLAYER_ENH_SHAMAN       = 18;  // enhancement_shaman = 18
const PLAYER_FERAL_DRUID      = 22;  // feral_druid = 22
const PLAYER_FERAL_TANK_DRUID = 26;  // feral_tank_druid = 26
const PLAYER_SMITE_PRIEST     = 20;  // smite_priest = 20 (used for Holy Priest computeStats)

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
    // Discipline (5 pts)
    talents.fieldVarint(PT_INNER_FOCUS,          1);  // bool — free spell on demand
    talents.fieldVarint(PT_MEDITATION,           3);  // 30% mana regen while casting
    // Shadow (56 pts)
    talents.fieldVarint(PT_IMP_SHADOW_WORD_PAIN, 2);  // +10% SWP damage
    talents.fieldVarint(PT_SHADOW_FOCUS,         5);  // -10% spell miss
    talents.fieldVarint(PT_IMP_MIND_BLAST,       5);  // -2.5s MB cooldown
    talents.fieldVarint(PT_MIND_FLAY,            1);  // bool — core ability
    talents.fieldVarint(PT_SHADOW_WEAVING,       5);  // +10% shadow damage taken
    talents.fieldVarint(PT_VAMPIRIC_EMBRACE,     1);  // bool — party healing
    talents.fieldVarint(PT_FOCUSED_MIND,         3);  // -15% mana cost
    talents.fieldVarint(PT_DARKNESS,             5);  // +10% shadow damage
    talents.fieldVarint(PT_SHADOWFORM,           1);  // bool — form
    talents.fieldVarint(PT_SHADOW_POWER,         5);  // +10% shadow crit damage
    talents.fieldVarint(PT_MISERY,               5);  // +5% spell hit debuff
    talents.fieldVarint(PT_VAMPIRIC_TOUCH,       1);  // bool — mana drain
    talents.fieldVarint(PT_SHADOW_AFFINITY,      3);  // -15% threat

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

// ─── Build RaidSimRequest for Combat Rogue (Human, Swords) ──────────────────

function buildRogueSimRequest(gearSlots, iterations, randomSeed) {
    const equipSpec = new ProtoWriter();
    for (const slot of gearSlots) {
        const itemSpec = new ProtoWriter();
        itemSpec.fieldVarint(ITEM_ID, slot.id);
        if (slot.enchant) itemSpec.fieldVarint(ITEM_ENCHANT, slot.enchant);
        for (const gem of (slot.gems || [])) itemSpec.fieldVarint(ITEM_GEMS, gem);
        equipSpec.fieldMessage(EQUIP_ITEMS, itemSpec);
    }

    // ── Rogue Rotation (Combat: Auto builder, Rupture+Shiv, maintain Expose Armor) ──
    const rotation = new ProtoWriter();
    rotation.fieldVarint(1, 1);  // maintain_expose_armor = true
    rotation.fieldVarint(2, 1);  // use_rupture = true
    rotation.fieldVarint(3, 1);  // builder = Auto (enum 1)
    rotation.fieldVarint(4, 3);  // min_combo_points_for_damage_finisher = 3
    rotation.fieldVarint(5, 1);  // use_shiv = true

    // ── RogueTalents — Combat Swords 20/41/0 ──
    const rogueTalents = new ProtoWriter();
    // Assassination tree (20 pts)
    rogueTalents.fieldVarint(RT_MALICE,                   5);
    rogueTalents.fieldVarint(RT_RUTHLESSNESS,             3);
    rogueTalents.fieldVarint(RT_MURDER,                   2);
    rogueTalents.fieldVarint(RT_LETHALITY,                5);
    rogueTalents.fieldVarint(RT_RELENTLESS_STRIKES,       1);
    // Improved Expose Armor 2/2 (field 7)
    rogueTalents.fieldVarint(7, 2);
    // Combat tree (41 pts)
    rogueTalents.fieldVarint(RT_IMPROVED_SINISTER_STRIKE, 2);
    // Improved Slice and Dice 3/3 (field 19)
    rogueTalents.fieldVarint(19, 3);
    rogueTalents.fieldVarint(RT_PRECISION,                5);
    rogueTalents.fieldVarint(RT_DUAL_WIELD_SPEC,          5);
    rogueTalents.fieldVarint(RT_BLADE_FLURRY,             1);
    rogueTalents.fieldVarint(RT_SWORD_SPEC,               5);
    rogueTalents.fieldVarint(RT_WEAPON_EXPERTISE,         2);
    rogueTalents.fieldVarint(RT_AGGRESSION,               3);
    rogueTalents.fieldVarint(RT_VITALITY,                 2);
    rogueTalents.fieldVarint(RT_ADRENALINE_RUSH,          1);
    rogueTalents.fieldVarint(RT_COMBAT_POTENCY,           5);
    rogueTalents.fieldVarint(RT_SURPRISE_ATTACKS,         1);

    // ── Rogue Options (empty) ──
    const rogueOptions = new ProtoWriter();

    // ── Rogue spec message ──
    const rogueSpec = new ProtoWriter();
    rogueSpec.fieldMessage(1, rotation);
    rogueSpec.fieldMessage(2, rogueTalents);
    rogueSpec.fieldMessageRequired(3, rogueOptions);

    // ── Consumes ──
    const consumes = new ProtoWriter();
    consumes.fieldVarint(CONS_FLASK, 4);           // FlaskOfRelentlessAssault
    consumes.fieldVarint(CONS_FOOD, 3);            // FoodGrilledMudfish (agi)
    consumes.fieldVarint(CONS_DEFAULT_POTION, 3);  // HastePotion
    consumes.fieldVarint(CONS_MH_IMBUE, 1);        // AdamantiteSharpeningStone
    consumes.fieldVarint(CONS_OH_IMBUE, 10);       // RogueDeadlyPoison

    // ── Individual buffs ──
    const indBuffs = new ProtoWriter();
    indBuffs.fieldVarint(IB_BLESSING_OF_KINGS, 1);
    indBuffs.fieldVarint(IB_BLESSING_OF_MIGHT, 2);

    // ── Player ──
    const player = new ProtoWriter();
    player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Combat Rogue'));
    player.fieldVarint(PLAYER_RACE, RACE_HUMAN);
    player.fieldVarint(PLAYER_CLASS, CLASS_ROGUE);
    player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
    player.fieldMessage(PLAYER_CONSUMES, consumes);
    player.fieldMessage(PLAYER_BUFFS, indBuffs);
    player.fieldMessage(PLAYER_ROGUE, rogueSpec);

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
        talents.fieldVarint(PT_INNER_FOCUS,          1);
        talents.fieldVarint(PT_MEDITATION,           3);
        talents.fieldVarint(PT_IMP_SHADOW_WORD_PAIN, 2);
        talents.fieldVarint(PT_SHADOW_FOCUS,         5);
        talents.fieldVarint(PT_IMP_MIND_BLAST,       5);
        talents.fieldVarint(PT_MIND_FLAY,            1);
        talents.fieldVarint(PT_SHADOW_WEAVING,       5);
        talents.fieldVarint(PT_VAMPIRIC_EMBRACE,     1);
        talents.fieldVarint(PT_FOCUSED_MIND,         3);
        talents.fieldVarint(PT_DARKNESS,             5);
        talents.fieldVarint(PT_SHADOWFORM,           1);
        talents.fieldVarint(PT_SHADOW_POWER,         5);
        talents.fieldVarint(PT_MISERY,               5);
        talents.fieldVarint(PT_VAMPIRIC_TOUCH,       1);
        talents.fieldVarint(PT_SHADOW_AFFINITY,      3);

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

    } else if (specKey === 'Rogue-Dps') {
        // ── Rogue (Combat Swords) — BiS P1 talents ──
        const rogueTalents = new ProtoWriter();
        rogueTalents.fieldVarint(RT_MALICE,                   5);  // +5% crit
        rogueTalents.fieldVarint(RT_RUTHLESSNESS,             3);  // CP on finishing moves
        rogueTalents.fieldVarint(RT_MURDER,                   2);  // +4% dmg
        rogueTalents.fieldVarint(RT_LETHALITY,                5);  // +30% crit bonus
        rogueTalents.fieldVarint(RT_RELENTLESS_STRIKES,       1);  // energy on finishers
        rogueTalents.fieldVarint(RT_SEAL_FATE,                5);  // CP on crit
        rogueTalents.fieldVarint(RT_IMPROVED_SINISTER_STRIKE, 2);  // -2 energy cost
        rogueTalents.fieldVarint(RT_PRECISION,                5);  // +5% hit
        rogueTalents.fieldVarint(RT_DUAL_WIELD_SPEC,          5);  // +5% OH dmg
        rogueTalents.fieldVarint(RT_SWORD_SPEC,               5);  // extra swings
        rogueTalents.fieldVarint(RT_WEAPON_EXPERTISE,         2);  // +10 weapon skill
        rogueTalents.fieldVarint(RT_AGGRESSION,               3);  // +6% dmg
        rogueTalents.fieldVarint(RT_VITALITY,                 2);  // +8% AP
        rogueTalents.fieldVarint(RT_COMBAT_POTENCY,           5);  // +15% OH energy
        rogueTalents.fieldVarint(RT_SURPRISE_ATTACKS,         1);  // no dodge on finisher

        const rogueSpec = new ProtoWriter();
        rogueSpec.fieldMessageRequired(1, new ProtoWriter());  // rotation
        rogueSpec.fieldMessage(2, rogueTalents);               // talents
        rogueSpec.fieldMessageRequired(3, new ProtoWriter());  // options

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_FLASK, 4);         // FlaskOfRelentlessAssault
        consumes.fieldVarint(CONS_FOOD, 3);          // FoodRavagerDog
        consumes.fieldVarint(CONS_DEFAULT_POTION, 3); // HastePotion
        consumes.fieldVarint(CONS_MH_IMBUE, 10);     // RogueDeadlyPoison = 10
        consumes.fieldVarint(CONS_OH_IMBUE, 10);

        const indBuffs = new ProtoWriter();
        indBuffs.fieldVarint(IB_BLESSING_OF_KINGS, 1);
        indBuffs.fieldVarint(IB_BLESSING_OF_MIGHT, 2);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Rogue'));
        player.fieldVarint(PLAYER_RACE, RACE_HUMAN);
        player.fieldVarint(PLAYER_CLASS, CLASS_ROGUE);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_BUFFS, indBuffs);
        player.fieldMessage(PLAYER_ROGUE, rogueSpec);

    } else if (specKey === 'Paladin-Retribution') {
        // ── Retribution Paladin — minimal spec for computeStats ──
        const retTalents = new ProtoWriter();
        retTalents.fieldVarint(PAL_CONVICTION,            5);  // +5% crit
        retTalents.fieldVarint(PAL_SEAL_OF_COMMAND,       1);  // key ability
        retTalents.fieldVarint(PAL_CRUSADE,               3);  // +3% dmg
        retTalents.fieldVarint(PAL_TWO_HAND_SPEC,         5);  // +10% 2H dmg
        retTalents.fieldVarint(PAL_VENGEANCE,             5);  // stacking dmg bonus
        retTalents.fieldVarint(PAL_SANCTIFIED_SEALS,      5);  // +5% crit
        retTalents.fieldVarint(PAL_FANATICISM,            5);  // +15% crit / -30% threat
        retTalents.fieldVarint(PAL_CRUSADER_STRIKE,       1);  // key ability
        retTalents.fieldVarint(PAL_IMPROVED_JUDGEMENT,    2);  // -1s cooldown
        retTalents.fieldVarint(PAL_BENEDICTION,           5);  // reduced mana cost

        const retSpec = new ProtoWriter();
        retSpec.fieldMessageRequired(1, new ProtoWriter());  // rotation
        retSpec.fieldMessage(2, retTalents);                 // talents
        retSpec.fieldMessageRequired(3, new ProtoWriter());  // options

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_FLASK, 4);          // FlaskOfRelentlessAssault
        consumes.fieldVarint(CONS_FOOD, 4);           // FoodRoastedClefthoof
        consumes.fieldVarint(CONS_DEFAULT_POTION, 3); // HastePotion
        consumes.fieldVarint(CONS_MH_IMBUE, 1);       // AdamantiteSharpeningStone

        const indBuffs = new ProtoWriter();
        indBuffs.fieldVarint(IB_BLESSING_OF_KINGS, 1);
        indBuffs.fieldVarint(IB_BLESSING_OF_MIGHT, 2);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Ret Paladin'));
        player.fieldVarint(PLAYER_RACE, RACE_HUMAN);
        player.fieldVarint(PLAYER_CLASS, CLASS_PALADIN);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_BUFFS, indBuffs);
        player.fieldMessage(PLAYER_RET_PALADIN, retSpec);

    } else if (specKey === 'Paladin-Protection') {
        // ── Protection Paladin — full talents for computeStats ──
        // Anticipation 5/5 = +20 defense skill (key for crit immunity!)
        const protPalTalents = new ProtoWriter();
        protPalTalents.fieldVarint(PAL_REDOUBT,            5);  // block on being crit
        protPalTalents.fieldVarint(PAL_PRECISION,          3);  // +3% hit
        protPalTalents.fieldVarint(PAL_TOUGHNESS,          5);  // +10% armor
        protPalTalents.fieldVarint(PAL_IMPROVED_RF,        3);  // Righteous Fury threat
        protPalTalents.fieldVarint(PAL_SHIELD_SPEC,        3);  // block procs
        protPalTalents.fieldVarint(PAL_ANTICIPATION,       5);  // +20 defense skill — KEY
        protPalTalents.fieldVarint(PAL_BLESSING_OF_SANCTUARY, 1); // block/parry rage
        protPalTalents.fieldVarint(PAL_SACRED_DUTY,        2);  // +6% stam
        protPalTalents.fieldVarint(PAL_ONE_HAND_SPEC,      5);  // +10% 1H dmg
        protPalTalents.fieldVarint(PAL_HOLY_SHIELD,        1);  // key ability
        protPalTalents.fieldVarint(PAL_ARDENT_DEFENDER,    3);  // survive killing blows
        protPalTalents.fieldVarint(PAL_COMBAT_EXPERTISE,   5);  // +10 expertise / +6% stam
        protPalTalents.fieldVarint(PAL_AVENGERS_SHIELD,    1);  // pull ability

        const protPalSpec = new ProtoWriter();
        protPalSpec.fieldMessageRequired(1, new ProtoWriter());  // rotation
        protPalSpec.fieldMessage(2, protPalTalents);             // talents
        protPalSpec.fieldMessageRequired(3, new ProtoWriter());  // options

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_FLASK, 6);          // FlaskOfFortification = 6
        consumes.fieldVarint(CONS_FOOD, 5);           // FoodGrilledMudfish = 5 (agi/stam)

        const indBuffs = new ProtoWriter();
        indBuffs.fieldVarint(IB_BLESSING_OF_KINGS, 1);
        indBuffs.fieldVarint(IB_BLESSING_OF_MIGHT, 2);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Prot Paladin'));
        player.fieldVarint(PLAYER_RACE, RACE_HUMAN);
        player.fieldVarint(PLAYER_CLASS, CLASS_PALADIN);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_BUFFS, indBuffs);
        player.fieldMessage(PLAYER_PROT_PALADIN, protPalSpec);

    } else if (specKey === 'Shaman-Enhancement') {
        // ── Enhancement Shaman — BiS P1 talents ──
        const enhTalents = new ProtoWriter();
        enhTalents.fieldVarint(ST_THUNDERING_STRIKES,  5);  // +5% melee crit
        enhTalents.fieldVarint(ST_ENHANCING_TOTEMS,    2);  // stronger totems
        enhTalents.fieldVarint(ST_SHAMANISTIC_FOCUS,   1);  // reduced cost on hit
        enhTalents.fieldVarint(ST_FLURRY,              5);  // +30% attack speed on crit
        enhTalents.fieldVarint(ST_ELEMENTAL_WEAPONS,   3);  // +30% weapon imbue
        enhTalents.fieldVarint(ST_MENTAL_QUICKNESS,    3);  // +30% SP from AP
        enhTalents.fieldVarint(ST_WEAPON_MASTERY,      5);  // +10 weapon skill
        enhTalents.fieldVarint(ST_DUAL_WIELD_SPEC,     5);  // +5% OH hit/dmg
        enhTalents.fieldVarint(ST_UNLEASHED_RAGE,      5);  // +10% AP aura
        enhTalents.fieldVarint(ST_STORMSTRIKE,         1);  // key ability
        enhTalents.fieldVarint(ST_SPIRIT_WEAPONS,      1);  // -30% threat
        enhTalents.fieldVarint(ST_SHAMANISTIC_RAGE,    1);  // mana return
        enhTalents.fieldVarint(ST_NATURES_GUIDANCE,    3);  // +3% hit

        const enhSpec = new ProtoWriter();
        enhSpec.fieldMessageRequired(1, new ProtoWriter());  // rotation
        enhSpec.fieldMessage(2, enhTalents);                 // talents
        enhSpec.fieldMessageRequired(3, new ProtoWriter());  // options

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_FLASK, 4);          // FlaskOfRelentlessAssault
        consumes.fieldVarint(CONS_FOOD, 4);           // FoodRoastedClefthoof
        consumes.fieldVarint(CONS_DEFAULT_POTION, 3); // HastePotion
        consumes.fieldVarint(CONS_MH_IMBUE, 9);       // ShamanWindfury = 9
        consumes.fieldVarint(CONS_OH_IMBUE, 7);       // ShamanRockbiter = 8, Flametongue = 6

        const indBuffs = new ProtoWriter();
        indBuffs.fieldVarint(IB_BLESSING_OF_KINGS, 1);
        indBuffs.fieldVarint(IB_BLESSING_OF_MIGHT, 2);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Enh Shaman'));
        player.fieldVarint(PLAYER_RACE, RACE_ORC);
        player.fieldVarint(PLAYER_CLASS, CLASS_SHAMAN);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_BUFFS, indBuffs);
        player.fieldMessage(PLAYER_ENH_SHAMAN, enhSpec);

    } else if (specKey === 'Druid-Cat') {
        // ── Feral Druid (Cat DPS) — BiS P1 talents ──
        // Key talents: Heart of the Wild (+20% AP in cat), Leader of the Pack, Mangle
        const catTalents = new ProtoWriter();
        catTalents.fieldVarint(DT_FEROCITY,              5);  // -5 energy cost
        catTalents.fieldVarint(DT_FERAL_AGGRESSION,      2);  // improved demo roar
        catTalents.fieldVarint(DT_THICK_HIDE,            3);  // +10% armor
        catTalents.fieldVarint(DT_SHARPENED_CLAWS,       3);  // +6% crit
        catTalents.fieldVarint(DT_PREDATORY_STRIKES,     3);  // +150% weapon bonus
        catTalents.fieldVarint(DT_PRIMAL_FURY,           2);  // extra CP on crit
        catTalents.fieldVarint(DT_HEART_OF_THE_WILD,     5);  // +20% AP in cat form
        catTalents.fieldVarint(DT_SURVIVAL_OF_THE_FITTEST, 3); // +3% all stats
        catTalents.fieldVarint(DT_LEADER_OF_THE_PACK,   1);  // +5% melee crit aura
        catTalents.fieldVarint(DT_MANGLE,                1);  // key ability

        const feralSpec = new ProtoWriter();
        feralSpec.fieldMessageRequired(1, new ProtoWriter());  // rotation
        feralSpec.fieldMessage(2, catTalents);                 // talents
        feralSpec.fieldMessageRequired(3, new ProtoWriter());  // options

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_FLASK, 4);          // FlaskOfRelentlessAssault
        consumes.fieldVarint(CONS_FOOD, 4);           // FoodRoastedClefthoof
        consumes.fieldVarint(CONS_DEFAULT_POTION, 3); // HastePotion

        const indBuffs = new ProtoWriter();
        indBuffs.fieldVarint(IB_BLESSING_OF_KINGS, 1);
        indBuffs.fieldVarint(IB_BLESSING_OF_MIGHT, 2);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Feral Cat'));
        player.fieldVarint(PLAYER_RACE, RACE_TAUREN);
        player.fieldVarint(PLAYER_CLASS, CLASS_DRUID);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_BUFFS, indBuffs);
        player.fieldMessage(PLAYER_FERAL_DRUID, feralSpec);

    } else if (specKey === 'Druid-Bear') {
        // ── Feral Tank Druid (Bear) — full talents for computeStats ──
        // Crit immunity comes from Survival of the Fittest 3/3 (-6% crit taken)
        // NOT from defense rating — displayed separately in UI
        const bearTalents = new ProtoWriter();
        bearTalents.fieldVarint(DT_FEROCITY,                5);  // -5 rage cost
        bearTalents.fieldVarint(DT_FERAL_AGGRESSION,        2);  // improved demo roar
        bearTalents.fieldVarint(DT_FERAL_INSTINCT,          3);  // +15% threat
        bearTalents.fieldVarint(DT_THICK_HIDE,              3);  // +10% armor in bear
        bearTalents.fieldVarint(DT_SHARPENED_CLAWS,         3);  // +6% crit
        bearTalents.fieldVarint(DT_PREDATORY_STRIKES,       3);
        bearTalents.fieldVarint(DT_PRIMAL_FURY,             2);
        bearTalents.fieldVarint(DT_HEART_OF_THE_WILD,       5);  // +20% stam in bear
        bearTalents.fieldVarint(DT_SURVIVAL_OF_THE_FITTEST, 3);  // CRIT IMMUNITY (-6%)
        bearTalents.fieldVarint(DT_LEADER_OF_THE_PACK,      1);  // bool
        bearTalents.fieldVarint(DT_MANGLE,                  1);  // bool

        const bearSpec = new ProtoWriter();
        bearSpec.fieldMessageRequired(1, new ProtoWriter());  // rotation
        bearSpec.fieldMessage(2, bearTalents);                // talents with SotF 3/3
        bearSpec.fieldMessageRequired(3, new ProtoWriter());  // options

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_FLASK, 6);          // FlaskOfFortification = 6
        consumes.fieldVarint(CONS_FOOD, 7);           // FoodFishermansFeast = 7
        consumes.fieldVarint(CONS_DEFAULT_POTION, 7); // IronshieldPotion = 7

        const indBuffs = new ProtoWriter();
        indBuffs.fieldVarint(IB_BLESSING_OF_KINGS, 1);
        indBuffs.fieldVarint(IB_BLESSING_OF_MIGHT, 2);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Feral Bear'));
        player.fieldVarint(PLAYER_RACE, RACE_TAUREN);
        player.fieldVarint(PLAYER_CLASS, CLASS_DRUID);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_BUFFS, indBuffs);
        player.fieldMessage(PLAYER_FERAL_TANK_DRUID, bearSpec);

    } else if (specKey === 'Warrior-Protection') {
        // ── Protection Warrior — full talents including Anticipation 5/5 ──
        const protWarTalents = new ProtoWriter();
        // Protection tree
        protWarTalents.fieldVarint(WT_TACTICAL_MASTERY,      3);  // keep rage on stance change
        protWarTalents.fieldVarint(WT_ANTICIPATION,          5);  // +5 defense skill — KEY for crit cap
        protWarTalents.fieldVarint(WT_SHIELD_SPECIALIZATION, 5);  // +5% block chance
        protWarTalents.fieldVarint(WT_TOUGHNESS,             5);  // +10% armor
        protWarTalents.fieldVarint(WT_DEFIANCE,              3);  // +15% threat
        protWarTalents.fieldVarint(WT_IMPROVED_SUNDER_ARMOR, 3);
        protWarTalents.fieldVarint(WT_SHIELD_SLAM,           1);  // bool: key ability
        protWarTalents.fieldVarint(WT_ONE_HAND_WEAPON_SPEC,  5);  // +5% 1H damage
        protWarTalents.fieldVarint(WT_FOCUSED_RAGE,          3);  // -3 rage cost
        protWarTalents.fieldVarint(WT_VITALITY,              5);  // +4% str/stam
        protWarTalents.fieldVarint(WT_DEVASTATE,             1);  // bool: key ability
        // Fury tree — points needed to reach Protection
        protWarTalents.fieldVarint(WT_CRUELTY,               5);  // 5/5 crit

        const protWarSpec = new ProtoWriter();
        protWarSpec.fieldMessageRequired(1, new ProtoWriter());  // rotation
        protWarSpec.fieldMessage(2, protWarTalents);             // talents
        protWarSpec.fieldMessageRequired(3, new ProtoWriter());  // options

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_FLASK, 6);          // FlaskOfFortification = 6
        consumes.fieldVarint(CONS_FOOD, 5);           // FoodGrilledMudfish = 5

        const indBuffs = new ProtoWriter();
        indBuffs.fieldVarint(IB_BLESSING_OF_KINGS, 1);
        indBuffs.fieldVarint(IB_BLESSING_OF_MIGHT, 2);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Prot Warrior'));
        player.fieldVarint(PLAYER_RACE, RACE_HUMAN);
        player.fieldVarint(PLAYER_CLASS, CLASS_WARRIOR);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_BUFFS, indBuffs);
        player.fieldMessage(PLAYER_PROT_WARRIOR, protWarSpec);

    } else if (specKey === 'Mage-Fire') {
        const mageTalents = new ProtoWriter();
        mageTalents.fieldVarint(MT_IMPROVED_FIREBALL,    5);
        mageTalents.fieldVarint(MT_IGNITE,               5);
        mageTalents.fieldVarint(MT_IMPROVED_SCORCH,      3);
        mageTalents.fieldVarint(MT_MASTER_OF_ELEMENTS,   3);
        mageTalents.fieldVarint(MT_PLAYING_WITH_FIRE,    3);
        mageTalents.fieldVarint(MT_CRITICAL_MASS,        3);
        mageTalents.fieldVarint(MT_FIRE_POWER,           5);
        mageTalents.fieldVarint(MT_PYROMANIAC,           3);
        mageTalents.fieldVarint(MT_COMBUSTION,           1);
        mageTalents.fieldVarint(MT_MOLTEN_FURY,          2);
        mageTalents.fieldVarint(MT_EMPOWERED_FIREBALL,   5);
        mageTalents.fieldVarint(MT_ARCANE_SUBTLETY,      2);
        mageTalents.fieldVarint(MT_ARCANE_CONCENTRATION, 5);

        const mageOptions = new ProtoWriter();
        mageOptions.fieldVarint(MO_ARMOR, 2);  // MoltenArmor

        const mageSpec = new ProtoWriter();
        mageSpec.fieldMessageRequired(MAGE_ROTATION, new ProtoWriter());
        mageSpec.fieldMessage(MAGE_TALENTS, mageTalents);
        mageSpec.fieldMessage(MAGE_OPTIONS, mageOptions);

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_SP_FLASK, 3);
        consumes.fieldVarint(CONS_SP_FOOD, 1);
        consumes.fieldVarint(CONS_SP_MH_IMBUE, 4);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Fire Mage'));
        player.fieldVarint(PLAYER_RACE, RACE_GNOME);
        player.fieldVarint(PLAYER_CLASS, CLASS_MAGE);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_MAGE, mageSpec);

    } else if (specKey === 'Mage-Frost') {
        const mageTalents = new ProtoWriter();
        mageTalents.fieldVarint(MT_IMPROVED_FROSTBOLT,     5);
        mageTalents.fieldVarint(MT_ELEMENTAL_PRECISION,    3);
        mageTalents.fieldVarint(MT_ICE_SHARDS,             5);
        mageTalents.fieldVarint(MT_PIERCING_ICE,           3);
        mageTalents.fieldVarint(MT_ICY_VEINS,              1);
        mageTalents.fieldVarint(MT_FROST_CHANNELING,       3);
        mageTalents.fieldVarint(MT_SHATTER,                5);
        mageTalents.fieldVarint(MT_WINTERS_CHILL,          5);
        mageTalents.fieldVarint(MT_ARCTIC_WINDS,           5);
        mageTalents.fieldVarint(MT_EMPOWERED_FROSTBOLT,    5);
        mageTalents.fieldVarint(MT_SUMMON_WATER_ELEMENTAL, 1);
        mageTalents.fieldVarint(MT_ARCANE_SUBTLETY,        2);
        mageTalents.fieldVarint(MT_ARCANE_CONCENTRATION,   5);

        const mageOptions = new ProtoWriter();
        mageOptions.fieldVarint(MO_ARMOR, 1);  // MageArmor

        const mageSpec = new ProtoWriter();
        mageSpec.fieldMessageRequired(MAGE_ROTATION, new ProtoWriter());
        mageSpec.fieldMessage(MAGE_TALENTS, mageTalents);
        mageSpec.fieldMessage(MAGE_OPTIONS, mageOptions);

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_SP_FLASK, 3);
        consumes.fieldVarint(CONS_SP_FOOD, 1);
        consumes.fieldVarint(CONS_SP_MH_IMBUE, 4);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Frost Mage'));
        player.fieldVarint(PLAYER_RACE, RACE_GNOME);
        player.fieldVarint(PLAYER_CLASS, CLASS_MAGE);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_MAGE, mageSpec);

    } else if (specKey === 'Mage-Arcane') {
        const mageTalents = new ProtoWriter();
        mageTalents.fieldVarint(MT_ARCANE_SUBTLETY,      2);
        mageTalents.fieldVarint(MT_ARCANE_CONCENTRATION, 5);
        mageTalents.fieldVarint(MT_ARCANE_MEDITATION,    3);
        mageTalents.fieldVarint(MT_PRESENCE_OF_MIND,     1);
        mageTalents.fieldVarint(MT_ARCANE_MIND,          5);
        mageTalents.fieldVarint(MT_ARCANE_INSTABILITY,   3);
        mageTalents.fieldVarint(MT_ARCANE_POTENCY,       2);
        mageTalents.fieldVarint(MT_ARCANE_POWER,         1);
        mageTalents.fieldVarint(MT_SPELL_POWER,          5);
        mageTalents.fieldVarint(MT_MIND_MASTERY,         5);
        mageTalents.fieldVarint(MT_IMPROVED_FIREBALL,    5);
        mageTalents.fieldVarint(MT_IGNITE,               5);

        const mageOptions = new ProtoWriter();
        mageOptions.fieldVarint(MO_ARMOR, 1);

        const mageSpec = new ProtoWriter();
        mageSpec.fieldMessageRequired(MAGE_ROTATION, new ProtoWriter());
        mageSpec.fieldMessage(MAGE_TALENTS, mageTalents);
        mageSpec.fieldMessage(MAGE_OPTIONS, mageOptions);

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_SP_FLASK, 3);
        consumes.fieldVarint(CONS_SP_FOOD, 1);
        consumes.fieldVarint(CONS_SP_MH_IMBUE, 4);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Arcane Mage'));
        player.fieldVarint(PLAYER_RACE, RACE_GNOME);
        player.fieldVarint(PLAYER_CLASS, CLASS_MAGE);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_MAGE, mageSpec);

    } else if (specKey === 'Warlock-Destruction') {
        const wlTalents = new ProtoWriter();
        wlTalents.fieldVarint(WLT_DEMONIC_EMBRACE,       5);
        wlTalents.fieldVarint(WLT_IMPROVED_SHADOW_BOLT,  5);
        wlTalents.fieldVarint(WLT_CATACLYSM,             5);
        wlTalents.fieldVarint(WLT_BANE,                  5);
        wlTalents.fieldVarint(WLT_DEVASTATION,           5);
        wlTalents.fieldVarint(WLT_RUIN,                  1);
        wlTalents.fieldVarint(WLT_EMBERSTORM,            5);
        wlTalents.fieldVarint(WLT_SOUL_LEECH,            4);
        wlTalents.fieldVarint(WLT_SHADOW_AND_FLAME,      5);

        const wlOptions = new ProtoWriter();
        wlOptions.fieldVarint(WLO_ARMOR, 1);    // FelArmor
        wlOptions.fieldVarint(WLO_SUMMON, 4);   // Felhound

        const wlSpec = new ProtoWriter();
        wlSpec.fieldMessageRequired(WARLOCK_ROTATION, new ProtoWriter());
        wlSpec.fieldMessage(WARLOCK_TALENTS, wlTalents);
        wlSpec.fieldMessage(WARLOCK_OPTIONS, wlOptions);

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_SP_FLASK, 3);
        consumes.fieldVarint(CONS_SP_FOOD, 1);
        consumes.fieldVarint(CONS_SP_MH_IMBUE, 4);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Destro Warlock'));
        player.fieldVarint(PLAYER_RACE, RACE_UNDEAD);
        player.fieldVarint(PLAYER_CLASS, CLASS_WARLOCK);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_WARLOCK, wlSpec);

    } else if (specKey === 'Warlock-Affliction') {
        const wlTalents = new ProtoWriter();
        wlTalents.fieldVarint(WLT_SUPPRESSION,            5);
        wlTalents.fieldVarint(WLT_IMPROVED_CORRUPTION,    5);
        wlTalents.fieldVarint(WLT_SOUL_SIPHON,            2);
        wlTalents.fieldVarint(WLT_NIGHTFALL,              2);
        wlTalents.fieldVarint(WLT_EMPOWERED_CORRUPTION,   3);
        wlTalents.fieldVarint(WLT_SIPHON_LIFE,            1);
        wlTalents.fieldVarint(WLT_SHADOW_MASTERY,         5);
        wlTalents.fieldVarint(WLT_CONTAGION,              5);
        wlTalents.fieldVarint(WLT_DARK_PACT,              1);
        wlTalents.fieldVarint(WLT_MALEDICTION,            3);
        wlTalents.fieldVarint(WLT_UNSTABLE_AFFLICTION,    1);
        wlTalents.fieldVarint(WLT_IMPROVED_SHADOW_BOLT,   5);
        wlTalents.fieldVarint(WLT_CATACLYSM,              2);

        const wlOptions = new ProtoWriter();
        wlOptions.fieldVarint(WLO_ARMOR, 1);
        wlOptions.fieldVarint(WLO_SUMMON, 4);

        const wlSpec = new ProtoWriter();
        wlSpec.fieldMessageRequired(WARLOCK_ROTATION, new ProtoWriter());
        wlSpec.fieldMessage(WARLOCK_TALENTS, wlTalents);
        wlSpec.fieldMessage(WARLOCK_OPTIONS, wlOptions);

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_SP_FLASK, 3);
        consumes.fieldVarint(CONS_SP_FOOD, 1);
        consumes.fieldVarint(CONS_SP_MH_IMBUE, 4);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Afflic Warlock'));
        player.fieldVarint(PLAYER_RACE, RACE_UNDEAD);
        player.fieldVarint(PLAYER_CLASS, CLASS_WARLOCK);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_WARLOCK, wlSpec);

    } else if (specKey === 'Warlock-Demonology') {
        const wlTalents = new ProtoWriter();
        wlTalents.fieldVarint(WLT_DEMONIC_EMBRACE,       5);
        wlTalents.fieldVarint(WLT_DEMONIC_TACTICS,       5);
        wlTalents.fieldVarint(WLT_SUMMON_FELGUARD,       1);
        wlTalents.fieldVarint(WLT_IMPROVED_SHADOW_BOLT,  5);
        wlTalents.fieldVarint(WLT_CATACLYSM,             5);
        wlTalents.fieldVarint(WLT_BANE,                  5);
        wlTalents.fieldVarint(WLT_RUIN,                  1);

        const wlOptions = new ProtoWriter();
        wlOptions.fieldVarint(WLO_ARMOR, 1);
        wlOptions.fieldVarint(WLO_SUMMON, 5);  // Felguard

        const wlSpec = new ProtoWriter();
        wlSpec.fieldMessageRequired(WARLOCK_ROTATION, new ProtoWriter());
        wlSpec.fieldMessage(WARLOCK_TALENTS, wlTalents);
        wlSpec.fieldMessage(WARLOCK_OPTIONS, wlOptions);

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_SP_FLASK, 3);
        consumes.fieldVarint(CONS_SP_FOOD, 1);
        consumes.fieldVarint(CONS_SP_MH_IMBUE, 4);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Demo Warlock'));
        player.fieldVarint(PLAYER_RACE, RACE_UNDEAD);
        player.fieldVarint(PLAYER_CLASS, CLASS_WARLOCK);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_WARLOCK, wlSpec);

    } else if (specKey === 'Hunter-Marksmanship') {
        const hunterTalents = new ProtoWriter();
        hunterTalents.fieldVarint(HT_IMPROVED_ASPECT_OF_HAWK, 5);
        hunterTalents.fieldVarint(HT_FOCUSED_FIRE,         2);
        hunterTalents.fieldVarint(HT_UNLEASHED_FURY,       5);
        hunterTalents.fieldVarint(HT_FEROCITY,             5);
        hunterTalents.fieldVarint(HT_LETHAL_SHOTS,         5);
        hunterTalents.fieldVarint(HT_IMPROVED_HUNTERS_MARK, 5);
        hunterTalents.fieldVarint(HT_EFFICIENCY,           5);
        hunterTalents.fieldVarint(HT_GO_FOR_THE_THROAT,    2);
        hunterTalents.fieldVarint(HT_AIMED_SHOT,           1);
        hunterTalents.fieldVarint(HT_MORTAL_SHOTS,         5);
        hunterTalents.fieldVarint(HT_BARRAGE,              3);
        hunterTalents.fieldVarint(HT_RANGED_WEAPON_SPEC,   5);
        hunterTalents.fieldVarint(HT_CAREFUL_AIM,          3);
        hunterTalents.fieldVarint(HT_TRUESHOT_AURA,        1);
        hunterTalents.fieldVarint(HT_MASTER_MARKSMAN,      5);

        const hunterOptions = new ProtoWriter();
        hunterOptions.fieldVarint(HRO_QUIVER_BONUS, 6);
        hunterOptions.fieldVarint(HRO_AMMO, 6);
        hunterOptions.fieldVarint(HRO_PET_TYPE, 2);
        hunterOptions.fieldVarint(HRO_PET_UPTIME, 1);

        const hunterRotation = new ProtoWriter();
        hunterRotation.fieldVarint(HR_USE_MULTI_SHOT, 1);
        hunterRotation.fieldVarint(HR_USE_ARCANE_SHOT, 1);
        hunterRotation.fieldVarint(HR_STING, 2);
        hunterRotation.fieldVarint(HR_WEAVE, 3);

        const hunterSpec = new ProtoWriter();
        hunterSpec.fieldMessage(HUNTER_ROTATION, hunterRotation);
        hunterSpec.fieldMessage(HUNTER_TALENTS, hunterTalents);
        hunterSpec.fieldMessage(HUNTER_OPTIONS, hunterOptions);

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_FLASK, 4);
        consumes.fieldVarint(CONS_FOOD, 4);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('MM Hunter'));
        player.fieldVarint(PLAYER_RACE, RACE_TROLL);
        player.fieldVarint(PLAYER_CLASS, CLASS_HUNTER);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_HUNTER, hunterSpec);

    } else if (specKey === 'Hunter-Beast Mastery') {
        const hunterTalents = new ProtoWriter();
        hunterTalents.fieldVarint(HT_IMPROVED_ASPECT_OF_HAWK, 5);
        hunterTalents.fieldVarint(HT_FOCUSED_FIRE,         2);
        hunterTalents.fieldVarint(HT_UNLEASHED_FURY,       5);
        hunterTalents.fieldVarint(HT_FEROCITY,             5);
        hunterTalents.fieldVarint(HT_BESTIAL_DISCIPLINE,   2);
        hunterTalents.fieldVarint(HT_FRENZY,               5);
        hunterTalents.fieldVarint(HT_FEROCIOUS_INSPIRATION, 3);
        hunterTalents.fieldVarint(HT_BESTIAL_WRATH,        1);
        hunterTalents.fieldVarint(HT_SERPENTS_SWIFTNESS,   5);
        hunterTalents.fieldVarint(HT_THE_BEAST_WITHIN,     1);
        hunterTalents.fieldVarint(HT_LETHAL_SHOTS,         5);
        hunterTalents.fieldVarint(HT_EFFICIENCY,           5);
        hunterTalents.fieldVarint(HT_MORTAL_SHOTS,         3);

        const hunterOptions = new ProtoWriter();
        hunterOptions.fieldVarint(HRO_QUIVER_BONUS, 6);
        hunterOptions.fieldVarint(HRO_AMMO, 6);
        hunterOptions.fieldVarint(HRO_PET_TYPE, 2);
        hunterOptions.fieldVarint(HRO_PET_UPTIME, 1);

        const hunterRotation = new ProtoWriter();
        hunterRotation.fieldVarint(HR_USE_MULTI_SHOT, 1);
        hunterRotation.fieldVarint(HR_USE_ARCANE_SHOT, 1);
        hunterRotation.fieldVarint(HR_STING, 2);
        hunterRotation.fieldVarint(HR_WEAVE, 3);

        const hunterSpec = new ProtoWriter();
        hunterSpec.fieldMessage(HUNTER_ROTATION, hunterRotation);
        hunterSpec.fieldMessage(HUNTER_TALENTS, hunterTalents);
        hunterSpec.fieldMessage(HUNTER_OPTIONS, hunterOptions);

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_FLASK, 4);
        consumes.fieldVarint(CONS_FOOD, 4);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('BM Hunter'));
        player.fieldVarint(PLAYER_RACE, RACE_TROLL);
        player.fieldVarint(PLAYER_CLASS, CLASS_HUNTER);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_HUNTER, hunterSpec);

    } else if (specKey === 'Hunter-Survival') {
        const hunterTalents = new ProtoWriter();
        hunterTalents.fieldVarint(HT_IMPROVED_ASPECT_OF_HAWK, 5);
        hunterTalents.fieldVarint(HT_UNLEASHED_FURY,       5);
        hunterTalents.fieldVarint(HT_FEROCITY,             5);
        hunterTalents.fieldVarint(HT_LETHAL_SHOTS,         5);
        hunterTalents.fieldVarint(HT_EFFICIENCY,           5);
        hunterTalents.fieldVarint(HT_MORTAL_SHOTS,         5);
        hunterTalents.fieldVarint(HT_RANGED_WEAPON_SPEC,   5);
        hunterTalents.fieldVarint(HT_CAREFUL_AIM,          3);
        hunterTalents.fieldVarint(HT_LIGHTNING_REFLEXES,   5);
        hunterTalents.fieldVarint(HT_THRILL_OF_THE_HUNT,   3);
        hunterTalents.fieldVarint(HT_EXPOSE_WEAKNESS,      3);
        hunterTalents.fieldVarint(HT_MASTER_TACTICIAN,     5);
        hunterTalents.fieldVarint(HT_READINESS,            1);

        const hunterOptions = new ProtoWriter();
        hunterOptions.fieldVarint(HRO_QUIVER_BONUS, 6);
        hunterOptions.fieldVarint(HRO_AMMO, 6);
        hunterOptions.fieldVarint(HRO_PET_TYPE, 2);
        hunterOptions.fieldVarint(HRO_PET_UPTIME, 1);

        const hunterRotation = new ProtoWriter();
        hunterRotation.fieldVarint(HR_USE_MULTI_SHOT, 1);
        hunterRotation.fieldVarint(HR_USE_ARCANE_SHOT, 1);
        hunterRotation.fieldVarint(HR_STING, 2);
        hunterRotation.fieldVarint(HR_WEAVE, 3);

        const hunterSpec = new ProtoWriter();
        hunterSpec.fieldMessage(HUNTER_ROTATION, hunterRotation);
        hunterSpec.fieldMessage(HUNTER_TALENTS, hunterTalents);
        hunterSpec.fieldMessage(HUNTER_OPTIONS, hunterOptions);

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_FLASK, 4);
        consumes.fieldVarint(CONS_FOOD, 4);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Surv Hunter'));
        player.fieldVarint(PLAYER_RACE, RACE_TROLL);
        player.fieldVarint(PLAYER_CLASS, CLASS_HUNTER);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_HUNTER, hunterSpec);

    } else if (specKey === 'Shaman-Elemental') {
        const eleTalents = new ProtoWriter();
        eleTalents.fieldVarint(EST_CONVECTION,            5);
        eleTalents.fieldVarint(EST_CONCUSSION,            5);
        eleTalents.fieldVarint(EST_CALL_OF_FLAME,         3);
        eleTalents.fieldVarint(EST_ELEMENTAL_FOCUS,       1);
        eleTalents.fieldVarint(EST_CALL_OF_THUNDER,       5);
        eleTalents.fieldVarint(EST_ELEMENTAL_DEVASTATION, 3);
        eleTalents.fieldVarint(EST_ELEMENTAL_FURY,        1);
        eleTalents.fieldVarint(EST_ELEMENTAL_PRECISION,   3);
        eleTalents.fieldVarint(EST_LIGHTNING_MASTERY,     5);
        eleTalents.fieldVarint(EST_ELEMENTAL_MASTERY,     1);
        eleTalents.fieldVarint(EST_LIGHTNING_OVERLOAD,    5);
        eleTalents.fieldVarint(EST_TOTEM_OF_WRATH,        1);

        const eleOptions = new ProtoWriter();
        eleOptions.fieldVarint(ESO_WATER_SHIELD, 1);
        eleOptions.fieldVarint(ESO_BLOODLUST, 1);

        const eleSpec = new ProtoWriter();
        eleSpec.fieldMessageRequired(ELE_SHAMAN_ROTATION, new ProtoWriter());
        eleSpec.fieldMessage(ELE_SHAMAN_TALENTS, eleTalents);
        eleSpec.fieldMessage(ELE_SHAMAN_OPTIONS, eleOptions);

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_SP_FLASK, 3);
        consumes.fieldVarint(CONS_SP_FOOD, 1);
        consumes.fieldVarint(CONS_SP_MH_IMBUE, 4);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Ele Shaman'));
        player.fieldVarint(PLAYER_RACE, RACE_TROLL);
        player.fieldVarint(PLAYER_CLASS, CLASS_SHAMAN);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_ELE_SHAMAN, eleSpec);

    } else if (specKey === 'Druid-Balance') {
        const druidTalents = new ProtoWriter();
        // Balance tree field numbers (from proto/druid.proto BalanceDruidTalents)
        druidTalents.fieldVarint(4,  5);  // focused_starlight
        druidTalents.fieldVarint(5,  5);  // improved_starfire
        druidTalents.fieldVarint(6,  1);  // insect_swarm (bool)
        druidTalents.fieldVarint(9,  5);  // vengeance
        druidTalents.fieldVarint(10, 3);  // lunar_guidance
        druidTalents.fieldVarint(11, 5);  // starlight_wrath
        druidTalents.fieldVarint(14, 3);  // celestial_focus
        druidTalents.fieldVarint(15, 5);  // moonfury
        druidTalents.fieldVarint(16, 2);  // balance_of_power
        druidTalents.fieldVarint(17, 1);  // moonkin_form (bool)
        druidTalents.fieldVarint(18, 5);  // empowered_starfire
        druidTalents.fieldVarint(20, 5);  // wrath_of_cenarius

        const balanceSpec = new ProtoWriter();
        balanceSpec.fieldMessageRequired(1, new ProtoWriter());
        balanceSpec.fieldMessage(2, druidTalents);
        balanceSpec.fieldMessageRequired(3, new ProtoWriter());

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_SP_FLASK, 3);
        consumes.fieldVarint(CONS_SP_FOOD, 1);
        consumes.fieldVarint(CONS_SP_MH_IMBUE, 4);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Balance Druid'));
        player.fieldVarint(PLAYER_RACE, RACE_TAUREN);
        player.fieldVarint(PLAYER_CLASS, CLASS_DRUID);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_BALANCE_DRUID, balanceSpec);

    } else if (specKey === 'Priest-Holy') {
        // ── Holy Priest — uses SmitePriest proto with Holy/Disc talents ──
        const holyTalents = new ProtoWriter();
        // Discipline tree
        holyTalents.fieldVarint(PT_MEDITATION,            3);  // 3/3 Meditation
        holyTalents.fieldVarint(PT_INNER_FOCUS,           1);  // Inner Focus
        holyTalents.fieldVarint(PT_MENTAL_AGILITY,        5);  // 5/5 Mental Agility
        holyTalents.fieldVarint(PT_MENTAL_STRENGTH,       5);  // 5/5 Mental Strength (+10% mana)
        holyTalents.fieldVarint(PT_DIVINE_SPIRIT,         1);  // Divine Spirit
        holyTalents.fieldVarint(PT_IMPROVED_DIVINE_SPIRIT,2);  // 2/2 IDS → spirit → SP
        holyTalents.fieldVarint(PT_ENLIGHTENMENT,         3);  // 3/3 → +6% int/stam/spirit
        // Holy tree
        holyTalents.fieldVarint(PT_HOLY_SPECIALIZATION,   5);  // 5/5 → +5% holy crit
        holyTalents.fieldVarint(PT_DIVINE_FURY,           5);  // 5/5 → faster GHeal
        holyTalents.fieldVarint(PT_SPIRITUAL_GUIDANCE,    5);  // 5/5 → 25% spirit → SP
        holyTalents.fieldVarint(PT_SURGE_OF_LIGHT,        2);  // 2/2
        holyTalents.fieldVarint(PT_SPIRIT_OF_REDEMPTION,  1);  // +5% spirit

        const holyOptions = new ProtoWriter();
        holyOptions.fieldVarint(SMITE_OPT_USE_SHADOWFIEND, 1);

        const holySpec = new ProtoWriter();
        holySpec.fieldMessageRequired(SMITE_ROTATION, new ProtoWriter());
        holySpec.fieldMessage(SMITE_TALENTS, holyTalents);
        holySpec.fieldMessage(SMITE_OPTIONS, holyOptions);

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_SP_FLASK, 3);           // FlaskOfPureDeath → sp flask
        consumes.fieldVarint(CONS_SP_FOOD, 1);            // BlackenedBasilisk
        consumes.fieldVarint(CONS_SP_DEFAULT_POTION, 2);  // SuperManaPotion
        consumes.fieldVarint(CONS_SP_MH_IMBUE, 4);        // SuperiorWizardOil

        const indBuffs = new ProtoWriter();
        indBuffs.fieldVarint(IB_BLESSING_OF_KINGS, 1);
        indBuffs.fieldVarint(IB_BLESSING_OF_WISDOM, 2);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Holy Priest'));
        player.fieldVarint(PLAYER_RACE, RACE_HUMAN);
        player.fieldVarint(PLAYER_CLASS, CLASS_PRIEST);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_BUFFS, indBuffs);
        player.fieldMessage(PLAYER_SMITE_PRIEST, holySpec);

    } else if (specKey === 'Paladin-Holy') {
        // ── Holy Paladin — uses RetributionPaladin proto with Holy talents ──
        const holyPalTalents = new ProtoWriter();
        // Holy tree
        holyPalTalents.fieldVarint(PAL_DIVINE_STRENGTH,      5);  // 5/5 → +10% str
        holyPalTalents.fieldVarint(PAL_DIVINE_INTELLECT,      5);  // 5/5 → +10% int
        holyPalTalents.fieldVarint(PAL_ILLUMINATION,          5);  // 5/5 → mana on crit
        holyPalTalents.fieldVarint(PAL_IMP_BLESSING_OF_WISDOM,2);  // 2/2
        holyPalTalents.fieldVarint(PAL_DIVINE_FAVOR,          1);  // Divine Favor
        holyPalTalents.fieldVarint(PAL_HOLY_POWER,            5);  // 5/5 → +5% holy crit
        holyPalTalents.fieldVarint(PAL_HOLY_GUIDANCE,         5);  // 5/5 → 35% int → SP
        holyPalTalents.fieldVarint(PAL_DIVINE_ILLUMINATION,   1);  // Divine Illumination
        // Protection dip
        holyPalTalents.fieldVarint(PAL_PRECISION,             3);  // 3/3 → +3% hit

        const retSpec = new ProtoWriter();
        retSpec.fieldMessageRequired(1, new ProtoWriter());  // rotation
        retSpec.fieldMessage(2, holyPalTalents);             // talents
        retSpec.fieldMessageRequired(3, new ProtoWriter());  // options

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_SP_FLASK, 3);
        consumes.fieldVarint(CONS_SP_FOOD, 1);
        consumes.fieldVarint(CONS_SP_DEFAULT_POTION, 2);
        consumes.fieldVarint(CONS_SP_MH_IMBUE, 4);

        const indBuffs = new ProtoWriter();
        indBuffs.fieldVarint(IB_BLESSING_OF_KINGS, 1);
        indBuffs.fieldVarint(IB_BLESSING_OF_WISDOM, 2);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Holy Paladin'));
        player.fieldVarint(PLAYER_RACE, RACE_HUMAN);
        player.fieldVarint(PLAYER_CLASS, CLASS_PALADIN);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_BUFFS, indBuffs);
        player.fieldMessage(PLAYER_RET_PALADIN, retSpec);

    } else if (specKey === 'Shaman-Restoration') {
        // ── Resto Shaman — uses ElementalShaman proto with Resto talents ──
        const restoShamTalents = new ProtoWriter();
        // Restoration tree
        restoShamTalents.fieldVarint(ST_TOTEMIC_FOCUS,        5);  // 5/5 → reduced totem cost
        restoShamTalents.fieldVarint(ST_NATURES_GUIDANCE,     3);  // 3/3 → +3% hit/spell hit
        restoShamTalents.fieldVarint(ST_RESTORATIVE_TOTEMS,   5);  // 5/5 → stronger mana spring
        restoShamTalents.fieldVarint(ST_TIDAL_MASTERY,        5);  // 5/5 → +5% heal/spell crit
        restoShamTalents.fieldVarint(ST_NATURES_SWIFTNESS_SHAM, 1); // NS
        restoShamTalents.fieldVarint(ST_MANA_TIDE_TOTEM,      1);  // MTT
        restoShamTalents.fieldVarint(ST_NATURES_BLESSING,     3);  // 3/3 → +30% SP from int

        const restoShamOptions = new ProtoWriter();
        restoShamOptions.fieldVarint(ESO_WATER_SHIELD, 1);

        const restoShamSpec = new ProtoWriter();
        restoShamSpec.fieldMessageRequired(ELE_SHAMAN_ROTATION, new ProtoWriter());
        restoShamSpec.fieldMessage(ELE_SHAMAN_TALENTS, restoShamTalents);
        restoShamSpec.fieldMessage(ELE_SHAMAN_OPTIONS, restoShamOptions);

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_SP_FLASK, 3);
        consumes.fieldVarint(CONS_SP_FOOD, 1);
        consumes.fieldVarint(CONS_SP_DEFAULT_POTION, 2);
        consumes.fieldVarint(CONS_SP_MH_IMBUE, 4);

        const indBuffs = new ProtoWriter();
        indBuffs.fieldVarint(IB_BLESSING_OF_KINGS, 1);
        indBuffs.fieldVarint(IB_BLESSING_OF_WISDOM, 2);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Resto Shaman'));
        player.fieldVarint(PLAYER_RACE, RACE_TROLL);
        player.fieldVarint(PLAYER_CLASS, CLASS_SHAMAN);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_BUFFS, indBuffs);
        player.fieldMessage(PLAYER_ELE_SHAMAN, restoShamSpec);

    } else if (specKey === 'Druid-Restoration') {
        // ── Resto Druid — uses BalanceDruid proto with Resto talents ──
        const restoDruidTalents = new ProtoWriter();
        // Restoration tree
        restoDruidTalents.fieldVarint(DT_IMP_MARK_OF_THE_WILD, 5);  // 5/5
        restoDruidTalents.fieldVarint(DT_FUROR,                 5);  // 5/5
        restoDruidTalents.fieldVarint(DT_NATURALIST,            5);  // 5/5 → -10% GHT
        restoDruidTalents.fieldVarint(DT_NATURAL_SHAPESHIFTER,  3);  // 3/3
        restoDruidTalents.fieldVarint(DT_INTENSITY,             3);  // 3/3 → mana regen in casting
        restoDruidTalents.fieldVarint(DT_OMEN_OF_CLARITY,       1);  // Clearcasting
        restoDruidTalents.fieldVarint(DT_NATURES_SWIFTNESS,     1);  // NS
        restoDruidTalents.fieldVarint(DT_LIVING_SPIRIT,         3);  // 3/3 → +15% spirit
        restoDruidTalents.fieldVarint(DT_NATURAL_PERFECTION,    3);  // 3/3 → +3% crit

        const restoDruidSpec = new ProtoWriter();
        restoDruidSpec.fieldMessageRequired(1, new ProtoWriter());  // rotation
        restoDruidSpec.fieldMessage(2, restoDruidTalents);          // talents
        restoDruidSpec.fieldMessageRequired(3, new ProtoWriter());  // options

        const consumes = new ProtoWriter();
        consumes.fieldVarint(CONS_SP_FLASK, 3);
        consumes.fieldVarint(CONS_SP_FOOD, 1);
        consumes.fieldVarint(CONS_SP_DEFAULT_POTION, 2);
        consumes.fieldVarint(CONS_SP_MH_IMBUE, 4);

        const indBuffs = new ProtoWriter();
        indBuffs.fieldVarint(IB_BLESSING_OF_KINGS, 1);
        indBuffs.fieldVarint(IB_BLESSING_OF_WISDOM, 2);

        player = new ProtoWriter();
        player.fieldBytes(PLAYER_NAME, new TextEncoder().encode('Resto Druid'));
        player.fieldVarint(PLAYER_RACE, RACE_TAUREN);
        player.fieldVarint(PLAYER_CLASS, CLASS_DRUID);
        player.fieldMessage(PLAYER_EQUIPMENT, equipSpec);
        player.fieldMessage(PLAYER_CONSUMES, consumes);
        player.fieldMessage(PLAYER_BUFFS, indBuffs);
        player.fieldMessage(PLAYER_BALANCE_DRUID, restoDruidSpec);

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
    const isCasterSpec = ['Priest-Shadow','Mage-Fire','Mage-Frost','Mage-Arcane',
        'Warlock-Destruction','Warlock-Affliction','Warlock-Demonology',
        'Shaman-Elemental','Druid-Balance',
        'Priest-Holy','Paladin-Holy','Shaman-Restoration','Druid-Restoration'].includes(specKey);
    if (isCasterSpec) {
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
    } else if (isCasterSpec) {
        // Standard caster debuffs (no shadow weaving/misery for non-priest)
        debuffs.fieldVarint(DB_JUDGEMENT_OF_WISDOM, 1);
        debuffs.fieldVarint(DB_CURSE_OF_ELEMENTS, 1);
        debuffs.fieldVarint(DB_FAERIE_FIRE, 2);
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

    runRogue(gearSlots, onProgress, iterations = 3000) {
        if (!this.ready) return Promise.reject(new Error('WASM not ready yet'));

        const request = buildRogueSimRequest(gearSlots, iterations, Math.floor(Math.random() * 0x7fffffff));
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
