const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  PermissionFlagsBits
} = require('discord.js');
require('dotenv').config();
const DEVELOPER_ID = '1299875574894039184';
const CO_DEVELOPER_ID = '742955843498278943';
const CO_DEVELOPER_ID_2 = '992632642992357459';

// Check if user is a developer
function isDeveloper(userId) {
  return userId === DEVELOPER_ID || userId === CO_DEVELOPER_ID || userId === CO_DEVELOPER_ID_2;
}

// === Prefix system (per-guild text command prefix) ===
const PREFIX_CACHE = new Map();

function validatePrefix(input) {
  if (typeof input !== 'string') return { ok: false, reason: 'Prefix must be text.' };
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'Prefix cannot be empty.' };
  if (trimmed.length > 5) return { ok: false, reason: 'Prefix must be 5 characters or less.' };
  if (/\s/.test(trimmed)) return { ok: false, reason: 'Prefix cannot contain spaces or whitespace.' };
  if (/[<>@#`/\\]/.test(trimmed)) return { ok: false, reason: 'Prefix cannot contain any of: < > @ # ` / \\' };
  if (!/^[\x21-\x7E]+$/.test(trimmed)) return { ok: false, reason: 'Prefix must be standard printable ASCII characters only.' };
  return { ok: true, prefix: trimmed };
}

async function getGuildPrefix(guildId) {
  if (!guildId) return null;
  if (PREFIX_CACHE.has(guildId)) return PREFIX_CACHE.get(guildId);
  if (!guildSettingsCollection) return null;
  try {
    const doc = await guildSettingsCollection.findOne({ _id: guildId });
    const prefix = doc && doc.prefix ? doc.prefix : null;
    PREFIX_CACHE.set(guildId, prefix);
    return prefix;
  } catch (err) {
    console.error('Failed to load guild prefix:', err);
    return null;
  }
}

async function setGuildPrefix(guildId, prefix) {
  if (!guildSettingsCollection) throw new Error('Database not ready');
  await guildSettingsCollection.updateOne(
    { _id: guildId },
    { $set: { prefix: prefix } },
    { upsert: true }
  );
  PREFIX_CACHE.set(guildId, prefix);
}


const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

// Validate required environment variables
if (!token) {
  console.error('ERROR: DISCORD_BOT_TOKEN is not set in environment variables');
  process.exit(1);
}

if (!clientId) {
  console.error('ERROR: DISCORD_CLIENT_ID is not set in environment variables');
  process.exit(1);
}
// MongoDB connection
let mongoClient;
let db;
let usersCollection;
let cooldownsCollection;
let eventSystemCollection;
let guildItemsCollection;
let globalItemsCollection;
let guildSettingsCollection;

// Initialize MongoDB connection
async function initializeDatabase() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error('ERROR: MONGODB_URI is not set in environment variables');
      process.exit(1);
    }

    mongoClient = new MongoClient(mongoUri, {
      ssl: true,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    await mongoClient.connect();
    console.log('Connected to MongoDB Atlas');

    db = mongoClient.db('fortunebot');
    usersCollection = db.collection('users');
    cooldownsCollection = db.collection('cooldowns');
    eventSystemCollection = db.collection('eventSystem');
    guildItemsCollection = db.collection('guildItems');
    globalItemsCollection = db.collection('globalItems');
    guildSettingsCollection = db.collection('guildSettings');

    // Initialize event system if it doesn't exist
    const eventSystem = await eventSystemCollection.findOne({ _id: 'main' });
    if (!eventSystem) {
      await eventSystemCollection.insertOne({
        _id: 'main',
        currentEvent: null,
        lastEventStart: 0,
        nextEventTime: Date.now() + (4 * 24 * 60 * 60 * 1000),
        eventHistory: []
      });
    }

    // Health check: Test write and read permissions
    await performDatabaseHealthCheck();

    // Add database connection diagnostics
    await logDatabaseDiagnostics();

    // Initialize global items if they don't exist
    await initializeGlobalItems();

  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    process.exit(1);
  }
}

// Global data objects (loaded from MongoDB)
let userData = {};
let cooldowns = { scavenge: {}, labor: {}, steal: {} };
global.tempItems = {};
global.activeTrades = {};
global.activeMarbleGames = {};
global.activeDuelGames = {};
global.messageTracker = {};
global.giveArtefactSessions = {};
global.massSellSessions = {};

// Graceful shutdown handler for Railway deployment
async function gracefulShutdown(signal) {
  console.log(`🔄 Received ${signal}, performing graceful shutdown...`);

  try {
    // Save all pending data
    console.log('💾 Saving all user data before shutdown...');
    await saveUserData();
    await saveCooldowns();

    // Close MongoDB connection
    if (mongoClient) {
      console.log('🔌 Closing MongoDB connection...');
      await mongoClient.close();
    }

    console.log('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
}

// Set up process handlers for Railway
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // Nodemon restart

// Database helper functions
async function getUser(userId) {
  if (!userData[userId]) {
    console.log(`🔍 Loading user ${userId} from database...`);
    const user = await usersCollection.findOne({ _id: userId });
    console.log(`🔍 Database returned for ${userId}:`, JSON.stringify(user, null, 2));
    userData[userId] = user || {
      cash: 0,
      artefacts: [],
      items: [],
      bankBalance: 0,
      joinedDate: Date.now(),
      commandCount: 0,
      observationPermission: 'prohibit',
      discoveredArtefacts: []
    };
    console.log(`🔍 Final userData for ${userId}:`, JSON.stringify(userData[userId], null, 2));
  }
  return userData[userId];
}

async function saveUser(userId) {
  if (!usersCollection) {
    console.warn('Users collection not ready, skipping save');
    return;
  }
  if (userData[userId]) {
    try {
      console.log(`💾 Attempting to save user ${userId} with data:`, JSON.stringify(userData[userId], null, 2));
      const result = await usersCollection.replaceOne(
        { _id: userId },
        { _id: userId, ...userData[userId] },
        { upsert: true }
      );
      console.log(`💾 Save result for ${userId}: Matched=${result.matchedCount}, Upserted=${result.upsertedCount}`);

      // Verify the save worked
      const verification = await usersCollection.findOne({ _id: userId });
      console.log(`🔍 Verification read for ${userId}:`, JSON.stringify(verification, null, 2));
    } catch (error) {
      console.error(`❌ Failed to save user ${userId}:`, error.message);
      throw error;
    }
  } else {
    console.warn(`⚠️  No data to save for user ${userId}`);
  }
}

async function getCooldowns() {
  const cooldownDoc = await cooldownsCollection.findOne({ _id: 'main' });
  const defaults = { scavenge: {}, labor: {}, steal: {} };

  if (!cooldownDoc) {
    return defaults;
  }

  // Merge with defaults to ensure all keys exist, even in old documents
  return {
    scavenge: cooldownDoc.scavenge || {},
    labor: cooldownDoc.labor || {},
    steal: cooldownDoc.steal || {}
  };
}

async function saveCooldowns() {
  if (!cooldownsCollection) {
    console.warn('Cooldowns collection not ready, skipping save');
    return;
  }
  try {
    const result = await cooldownsCollection.replaceOne(
      { _id: 'main' },
      { _id: 'main', ...cooldowns },
      { upsert: true }
    );
    console.log(`💾 Cooldowns: Matched=${result.matchedCount}, Upserted=${result.upsertedCount}`);
  } catch (error) {
    console.error('❌ Failed to save cooldowns:', error.message);
    throw error;
  }
}

async function getEventSystem() {
  return await eventSystemCollection.findOne({ _id: 'main' });
}

async function saveEventSystem(eventData) {
  try {
    const result = await eventSystemCollection.replaceOne(
      { _id: 'main' },
      { _id: 'main', ...eventData },
      { upsert: true }
    );
    console.log(`💾 Event System: Matched=${result.matchedCount}, Upserted=${result.upsertedCount}`);
  } catch (error) {
    console.error('❌ Failed to save event system:', error.message);
    throw error;
  }
}

async function getXpData(userId) {
  const user = await getUser(userId);
  if (!user.xpData) {
    user.xpData = { xp: 0, messageCount: 0, lastMessage: 0 };
    await saveUser(userId);
  }
  return user.xpData;
}

async function getGuildItems(guildId) {
  const guildDoc = await guildItemsCollection.findOne({ _id: guildId });
  return guildDoc?.items || {};
}

async function saveGuildItems(guildId, items) {
  try {
    const result = await guildItemsCollection.replaceOne(
      { _id: guildId },
      { _id: guildId, items },
      { upsert: true }
    );
    console.log(`💾 Guild Items [${guildId}]: Matched=${result.matchedCount}, Upserted=${result.upsertedCount}`);
  } catch (error) {
    console.error(`❌ Failed to save guild items for ${guildId}:`, error.message);
    throw error;
  }
}

// Global Items System
async function initializeGlobalItems() {
  try {
    const globalItems = await globalItemsCollection.findOne({ _id: 'main' });
    if (!globalItems) {
      await globalItemsCollection.insertOne({
        _id: 'main',
        items: {
          'Bank Expansion Ticket': {
            name: 'Bank Expansion Ticket',
            basePrice: 25000,
            description: 'Increases your bank capacity by 25%. Price increases with each purchase.',
            type: 'bank_expansion',
            multiplier: 1.25
          }
        }
      });
      console.log('✅ Global items initialized with Bank Expansion Ticket');
    }
  } catch (error) {
    console.error('❌ Failed to initialize global items:', error.message);
    throw error;
  }
}

async function getGlobalItems() {
  const globalDoc = await globalItemsCollection.findOne({ _id: 'main' });
  return globalDoc?.items || {};
}

// Bank Expansion System
async function calculateBankCapacity(userId) {
  const user = await getUser(userId);
  const expansions = user.bankExpansions || 0;
  const baseCapacity = 50000;
  const expansionPercent = 0.25; // 25% per expansion

  return Math.floor(baseCapacity * Math.pow(1 + expansionPercent, expansions));
}

async function calculateExpansionPrice(userId) {
  const user = await getUser(userId);
  const expansions = user.bankExpansions || 0;
  const basePrice = 25000;
  const multiplier = 1.25;

  return Math.floor(basePrice * Math.pow(multiplier, expansions));
}

async function getUserBankExpansions(userId) {
  const user = await getUser(userId);
  return user.bankExpansions || 0;
}

async function purchaseBankExpansion(userId) {
  try {
    const user = await getUser(userId);
    const currentExpansions = user.bankExpansions || 0;
    const price = await calculateExpansionPrice(userId);

    if (user.cash < price) {
      return { success: false, error: 'insufficient_funds', price, cash: user.cash };
    }

    // Process purchase
    user.cash -= price;
    user.bankExpansions = currentExpansions + 1;
    await saveUser(userId);

    const newCapacity = await calculateBankCapacity(userId);

    return { 
      success: true, 
      newExpansions: user.bankExpansions,
      newCapacity: newCapacity,
      price: price
    };
  } catch (error) {
    console.error(`❌ Failed to purchase bank expansion for ${userId}:`, error.message);
    return { success: false, error: 'system_error' };
  }
}

// Database connection diagnostics
async function logDatabaseDiagnostics() {
  try {
    console.log('📊 MongoDB Connection Diagnostics:');
    console.log(`   Database: ${db.databaseName}`);

    const userCount = await usersCollection.countDocuments();
    console.log(`   Users collection: ${userCount} documents`);

    // Check connection status and authentication
    const connStatus = await db.admin().command({ connectionStatus: 1 });
    if (connStatus.authInfo && connStatus.authInfo.authenticatedUsers) {
      const users = connStatus.authInfo.authenticatedUsers;
      console.log(`   Authenticated as: ${JSON.stringify(users)}`);
    }

    const mongoUri = process.env.MONGODB_URI;
    const hostMatch = mongoUri.match(/@([^/]+)/);
    if (hostMatch) {
      console.log(`   MongoDB Host: ${hostMatch[1]}`);
    }

    console.log('📊 Database diagnostics completed');
  } catch (error) {
    console.error('❌ Database diagnostics failed:', error.message);
  }
}

// Database health check function
async function performDatabaseHealthCheck() {
  try {
    console.log('🏥 Performing MongoDB health check...');

    // Test write permission
    const testDoc = { _id: 'health_check', timestamp: Date.now(), test: 'write_read_test' };
    const writeResult = await usersCollection.replaceOne(
      { _id: 'health_check' },
      testDoc,
      { upsert: true }
    );

    console.log(`✅ Write test - Matched: ${writeResult.matchedCount}, Upserted: ${writeResult.upsertedCount}`);

    // Test read permission
    const readResult = await usersCollection.findOne({ _id: 'health_check' });

    if (readResult && readResult.test === 'write_read_test') {
      console.log('✅ Read test - SUCCESS');

      // Clean up test document
      await usersCollection.deleteOne({ _id: 'health_check' });
      console.log('✅ Database health check PASSED - Read/Write permissions confirmed');
    } else {
      console.error('❌ Read test FAILED - Could not read back test document');
      throw new Error('Database read test failed');
    }

  } catch (error) {
    console.error('❌ DATABASE HEALTH CHECK FAILED:', error.message);
    console.error('This explains why data is not persisting!');
    throw error;
  }
}

// Legacy save functions (now async and use MongoDB)
async function saveUserData() {
  if (!usersCollection) {
    console.warn('Users collection not ready, skipping save');
    return;
  }
  try {
    const userPromises = Object.keys(userData).map(userId => saveUser(userId));
    await Promise.all(userPromises);
    console.log(`💾 Saved data for ${Object.keys(userData).length} users to MongoDB`);
  } catch (error) {
    console.error('❌ SAVE FAILED:', error.message);
    throw error;
  }
}

// Rarity and artefact config
const rarities = [
  { name:'Common',    chance:65, color:0xAAAAAA, value:100,   sell:150,   items:['Quartz','Mica','Olivine','Condensed Quartz','Calcite Crystal','Feldspar','Flint Chip','Shale Flake','Agate Cluster','Basalt Prism','Diorite Slab','Lignite Chip','Travertine Fragment','Smoky Quartz','Sandstone Carving','Pumice Dome'] },
  { name:'Uncommon',  chance:20, color:0x00FF00, value:500,   sell:500,   items:['Garnet','Talc','Magnetite','Lithium Battery','Hornblende','Limestone Tablet','Serpentine','Ring of Malachite','Jade Scarab','Dolomite Tablet','Augite Crystal','Stibnite Wand','Chalcopyrite','Crown of Gypsum','Rhodochrosite'] },
  { name:'Rare',      chance:10, color:0x00008B, value:1500,  sell:1500,  items:['Eye of Monazite','Chest of Xenotime','Euxenite','Beryl','Loparite','Amber Fossil','Obsidian Blade','Scepter of Rhodonite','Turquoise Idol','Spectrolite Lens','Vanadinite Cluster','Wulfenite Plate','Brazilianite Shard','Mask of Dioptase','Alexandrite Prism'] },
  { name:'Legendary', chance:4,  color:0xFFD700, value:5000,  sell:5000,  items:['Watch of Scandium','Statue of Bastnasite','Allanite','Fluorite Shard','Ixiolite','Lapis Lazuli','Nephrite Goblet','Citrine Crest','Staff of Chrysoberyl','Relic of Moissanite','Orb of Tanzanite','Spessartine Dagger','Demantoid Shard','Crown of Benitoite','Throne of Jadeite','Taaffeite Pendant'] },
  { name:'Unknown',   chance:1,  color:0x000000, value:15000, sell:15000, items:['Gem of Diamond','Kyawthuite','Hazenite Droplet','Ephemeral Allanite','Meteorite Shard','Coesite Fragment','Painite Crystal','Scepter of Onyx','Primordial Opal','Musgravite Fragment','Pezzottaite Core','Void Calcite','Serendibite Relic','Grandidierite Prism','Stellar Obsidian'] }
];

// Tier for each artefact — T1=65% value, T2=75%, T3=100%, T4=125%, T5=135%
const artefactTiers = {
  // Common
  'Quartz': 2, 'Mica': 2, 'Olivine': 2,
  'Condensed Quartz': 2,
  'Calcite Crystal': 3,
  'Feldspar': 1, 'Flint Chip': 1, 'Shale Flake': 1,
  'Agate Cluster': 3, 'Basalt Prism': 3,
  'Diorite Slab': 4, 'Lignite Chip': 4, 'Travertine Fragment': 4,
  'Smoky Quartz': 5, 'Sandstone Carving': 5, 'Pumice Dome': 5,
  // Uncommon
  'Garnet': 2, 'Talc': 2, 'Magnetite': 2,
  'Lithium Battery': 3,
  'Hornblende': 1, 'Limestone Tablet': 1, 'Serpentine': 1,
  'Ring of Malachite': 3, 'Jade Scarab': 3,
  'Dolomite Tablet': 4, 'Augite Crystal': 4, 'Stibnite Wand': 4,
  'Chalcopyrite': 5, 'Crown of Gypsum': 5, 'Rhodochrosite': 5,
  // Rare
  'Eye of Monazite': 2, 'Chest of Xenotime': 2, 'Euxenite': 2,
  'Beryl': 1,
  'Loparite': 3,
  'Amber Fossil': 1, 'Obsidian Blade': 1,
  'Scepter of Rhodonite': 3, 'Turquoise Idol': 3,
  'Spectrolite Lens': 4, 'Vanadinite Cluster': 4, 'Wulfenite Plate': 4,
  'Brazilianite Shard': 5, 'Mask of Dioptase': 5, 'Alexandrite Prism': 5,
  // Legendary
  'Watch of Scandium': 2, 'Statue of Bastnasite': 2, 'Allanite': 2,
  'Fluorite Shard': 1, 'Nephrite Goblet': 1,
  'Ixiolite': 2,
  'Lapis Lazuli': 3,
  'Citrine Crest': 1,
  'Staff of Chrysoberyl': 3, 'Relic of Moissanite': 3,
  'Orb of Tanzanite': 4, 'Spessartine Dagger': 4, 'Demantoid Shard': 4,
  'Crown of Benitoite': 5, 'Throne of Jadeite': 5, 'Taaffeite Pendant': 5,
  // Unknown
  'Gem of Diamond': 2, 'Kyawthuite': 2,
  'Hazenite Droplet': 1,
  'Ephemeral Allanite': 3,
  'Meteorite Shard': 1, 'Coesite Fragment': 1,
  'Painite Crystal': 2,
  'Scepter of Onyx': 3, 'Primordial Opal': 3,
  'Musgravite Fragment': 4, 'Pezzottaite Core': 4, 'Void Calcite': 4,
  'Serendibite Relic': 5, 'Grandidierite Prism': 5, 'Stellar Obsidian': 5
};

const TIER_MULTIPLIERS = { 1: 0.65, 2: 0.75, 3: 1.0, 4: 1.25, 5: 1.35 };

function getArtefactTier(name) {
  const cleanName = name.startsWith('✨ SHINY ') && name.endsWith(' ✨')
    ? name.replace('✨ SHINY ', '').replace(' ✨', '')
    : name;
  return artefactTiers[cleanName] || 2;
}

function calcArtefactSellValue(name, rarity) {
  const tier = getArtefactTier(name);
  const base = rarity ? rarity.sell : 100;
  return Math.floor(base * TIER_MULTIPLIERS[tier]);
}

function calcArtefactValue(name, rarity) {
  const tier = getArtefactTier(name);
  const base = rarity ? rarity.value : 100;
  return Math.floor(base * TIER_MULTIPLIERS[tier]);
}

function getRarityByArtefact(name) {
  const cleanName = name.startsWith('✨ SHINY ') && name.endsWith(' ✨') ? name.replace('✨ SHINY ', '').replace(' ✨', '') : name;
  return rarities.find(r => r.items.includes(cleanName));
}

// === EVENT SYSTEM ===

// Get all possible artefacts from all rarities
function getAllArtefacts() {
  return rarities.flatMap(rarity => rarity.items);
}

// Check and handle event system
async function checkAndHandleEvents() {
  const now = Date.now();
  const eventData = await getEventSystem();

  // Check if current event should end
  if (eventData.currentEvent && now >= eventData.currentEvent.endTime) {
    await endCurrentEvent();
  }

  // Check if new event should start
  if (!eventData.currentEvent && now >= eventData.nextEventTime) {
    await startNewEvent();
  }
}

async function startNewEvent() {
  const allArtefacts = getAllArtefacts();
  const now = Date.now();

  // Randomly select two different artefacts
  const shuffledArtefacts = [...allArtefacts].sort(() => Math.random() - 0.5);
  const negativeArtefact = shuffledArtefacts[0];
  const positiveArtefact = shuffledArtefacts[1];

  const newEvent = {
    id: `event_${now}`,
    startTime: now,
    endTime: now + (24 * 60 * 60 * 1000), // 24 hours
    negativeArtefact,
    positiveArtefact,
    type: 'mine_collapse'
  };

  const eventData = await getEventSystem();
  eventData.currentEvent = newEvent;
  eventData.lastEventStart = now;
  eventData.nextEventTime = now + (4 * 24 * 60 * 60 * 1000); // Next event in 4 days
  eventData.eventHistory.unshift(newEvent);

  // Keep only last 10 events in history
  if (eventData.eventHistory.length > 10) {
    eventData.eventHistory = eventData.eventHistory.slice(0, 10);
  }

  await saveEventSystem(eventData);
  broadcastEventStart(newEvent);
}

async function endCurrentEvent() {
  const eventData = await getEventSystem();
  const event = eventData.currentEvent;
  if (!event) return;

  eventData.currentEvent = null;
  await saveEventSystem(eventData);
  broadcastEventEnd(event);
}

async function broadcastEventStart(event) {
  try {
    // Create event start embed
    const eventEmbed = new EmbedBuilder()
      .setTitle('MINING CRISIS ALERT!')
      .setDescription(`**A catastrophic mine collapse has occurred in the ${event.negativeArtefact} mining sector!**`)
      .addFields(
        { 
          name: 'Mine Collapse Report', 
          value: `The **${event.negativeArtefact}** mine has suffered a devastating collapse! Explorers cannot approach the mining site due to unstable conditions and falling debris.`, 
          inline: false 
        },
        { 
          name: 'Scavenging Restriction', 
          value: `**${event.negativeArtefact}** cannot be scavenged during this 24-hour emergency period while repair crews work to stabilize the site.`, 
          inline: false 
        },
        { 
          name: 'Unexpected Opportunity', 
          value: `However, the nearby **${event.positiveArtefact}** mine has expanded due to shifting geological conditions, creating new accessible veins!`, 
          inline: false 
        },
        { 
          name: 'Enhanced Discovery Rate', 
          value: `**${event.positiveArtefact}** discovery chances have **doubled** during this event! Scavenge while this opportunity lasts!`, 
          inline: false 
        },
        { 
          name: 'Event Duration', 
          value: 'This mining crisis will last exactly **24 hours**', 
          inline: true 
        },
        { 
          name: 'Estimated Repair Time', 
          value: 'Mine restoration crews are working around the clock', 
          inline: true 
        }
      )
      .setColor(0xFF4500)
      .setFooter({ text: 'Fortune Bot Mining Authority • Emergency Broadcast System' })
      .setTimestamp();

    // Send to all channels where the bot is active (this is a simplified approach)
    // In a real implementation, you'd want to store channel IDs to broadcast to
    console.log('MINING EVENT STARTED:', event);

  } catch (error) {
    console.error('Error broadcasting event start:', error);
  }
}

async function broadcastEventEnd(event) {
  try {
    const eventEmbed = new EmbedBuilder()
      .setTitle('MINING OPERATIONS RESTORED')
      .setDescription('**The mining crisis has been resolved!**')
      .addFields(
        { 
          name: 'Restoration Complete', 
          value: `The **${event.negativeArtefact}** mine has been fully repaired and stabilized. Safety inspectors have cleared the site for normal operations.`, 
          inline: false 
        },
        { 
          name: 'Mining Status', 
          value: `**${event.negativeArtefact}** is now available for scavenging again at normal rates.`, 
          inline: false 
        },
        { 
          name: 'Geological Shift', 
          value: `The **${event.positiveArtefact}** mine has returned to standard geological conditions and normal discovery rates.`, 
          inline: false 
        },
        { 
          name: 'Operations Summary', 
          value: 'All mining sectors have returned to baseline scavenging probabilities', 
          inline: false 
        }
      )
      .setColor(0x00FF7F)
      .setFooter({ text: 'Fortune Bot Mining Authority • All Clear Signal' })
      .setTimestamp();

    console.log('MINING EVENT ENDED:', event);

  } catch (error) {
    console.error('Error broadcasting event end:', error);
  }
}

// Modified scavenge function to account for events
async function getModifiedArtefactChances() {
  const eventData = await getEventSystem();
  const event = eventData.currentEvent;
  if (!event) return rarities; // No event active, return normal chances

  // Create modified rarities based on current event
  return rarities.map(rarity => {
    const modifiedItems = rarity.items.map(item => {
      if (item === event.negativeArtefact) {
        // This artefact cannot be found during the event
        return null;
      }
      return item;
    }).filter(item => item !== null);

    // If positive artefact is in this rarity, double its effective chance
    const hasPositiveArtefact = rarity.items.includes(event.positiveArtefact);

    return {
      ...rarity,
      items: modifiedItems,
      // If this rarity contains the positive artefact, increase its chance
      chance: hasPositiveArtefact ? rarity.chance * 1.5 : rarity.chance
    };
  }).filter(rarity => rarity.items.length > 0); // Remove rarities with no items
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// XP System - Message tracking for conversation detection
client.on('messageCreate', async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // Database not ready yet — ignore until fully initialised
  if (!usersCollection) return;

  // === Prefix command dispatch ===
  if (message.guildId) {
    try {
      const prefix = await getGuildPrefix(message.guildId);
      if (prefix && message.content.startsWith(prefix)) {
        const body = message.content.slice(prefix.length).trim();
        if (body.length) {
          const tokens = body.split(/\s+/);
          const handled = await dispatchPrefixCommand(message, tokens);
          if (handled) return;
        }
      }
    } catch (err) {
      console.error('Prefix dispatch error:', err);
    }
  }

  const userId = message.author.id;
  const channelId = message.channel.id;
  const now = Date.now();

  // Load user data from database first
  const user = await getUser(userId);
  if (!user.xpData) user.xpData = { xp: 0, messageCount: 0, lastMessage: 0 };

  // Initialize channel tracking
  if (!global.messageTracker[channelId]) global.messageTracker[channelId] = [];

  // Add this message to channel tracker
  global.messageTracker[channelId].push({
    userId: userId,
    timestamp: now
  });

  // Clean old messages (only keep last 5 minutes)
  global.messageTracker[channelId] = global.messageTracker[channelId].filter(
    msg => now - msg.timestamp < 300000 // 5 minutes
  );

  // Check if this is part of a conversation
  const recentMessages = global.messageTracker[channelId].filter(
    msg => now - msg.timestamp < 120000 // 2 minutes
  );

  // Get unique users who have sent messages in the last 2 minutes
  const uniqueUsers = new Set(recentMessages.map(msg => msg.userId));

  // Only award XP if there's a conversation (at least 2 different users)
  if (uniqueUsers.size >= 2) {
    user.xpData.messageCount++;

    // Award XP every 2 messages
    if (user.xpData.messageCount % 2 === 0) {
      user.xpData.xp++;
      user.xpData.lastMessage = now;
      await saveUserData();
    }
  }
});

client.once('clientReady', async () => {
  console.log(`Fortune Bot online as ${client.user.tag}`);

  // Initialize MongoDB connection
  await initializeDatabase();

  // Load cooldowns from database
  cooldowns = await getCooldowns();

  // Initialize event system checking
  checkAndHandleEvents();

  // Set up periodic event checking every 15 minutes
  setInterval(() => {
    checkAndHandleEvents();
  }, 15 * 60 * 1000);

  // Register all slash commands
  const commands = [
    new SlashCommandBuilder()
      .setName('info')
      .setDescription('Shows information about the bot'),

    new SlashCommandBuilder()
      .setName('bank')
      .setDescription('Deposit money into your secure bank account')
      .addIntegerOption(option =>
        option.setName('amount')
          .setDescription('Amount to deposit')
          .setRequired(true)
          .setMinValue(1)),

    new SlashCommandBuilder()
      .setName('bank-all')
      .setDescription('Deposit all cash on hand into your bank account'),

    new SlashCommandBuilder()
      .setName('withdraw')
      .setDescription('Withdraw money from your bank account')
      .addIntegerOption(option =>
        option.setName('amount')
          .setDescription('Amount to withdraw')
          .setRequired(true)
          .setMinValue(1)),

    new SlashCommandBuilder()
      .setName('steal')
      .setDescription('Attempt to steal cash from another player')
      .addUserOption(option =>
        option.setName('target')
          .setDescription('User to steal from')
          .setRequired(true))
      .addIntegerOption(option =>
        option.setName('amount')
          .setDescription('Amount to steal')
          .setRequired(true)
          .setMinValue(1)),

    new SlashCommandBuilder()
      .setName('scavenge')
      .setDescription('Search for rare artefacts (2 hour cooldown)'),

    new SlashCommandBuilder()
      .setName('labor')
      .setDescription('Work to earn money (40 minute cooldown)'),

    new SlashCommandBuilder()
      .setName('inventory')
      .setDescription('View your cash, bank balance and artefacts'),

    new SlashCommandBuilder()
      .setName('trade')
      .setDescription('Start a trade with another user')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to trade with')
          .setRequired(true)),

    new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('View the leaderboard and your current rating'),

    new SlashCommandBuilder()
      .setName('store')
      .setDescription('View available items in global and server stores')
      .setDMPermission(false),

    new SlashCommandBuilder()
      .setName('buy')
      .setDescription('Purchase an item from the global store')
      .addStringOption(option =>
        option.setName('item')
          .setDescription('Name of the item to purchase')
          .setRequired(true)),

    new SlashCommandBuilder()
      .setName('mass-sell')
      .setDescription('Open an interactive menu to select and sell artefacts from your inventory'),

    new SlashCommandBuilder()
      .setName('add-item')
      .setDescription('Add a custom server item (Admin only)')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('Name of the item')
          .setRequired(true))
      .addIntegerOption(option =>
        option.setName('price')
          .setDescription('Price of the item')
          .setRequired(true)
          .setMinValue(1))
      .addStringOption(option =>
        option.setName('description')
          .setDescription('Description of the item')
          .setRequired(false))
      .setDMPermission(false),

    new SlashCommandBuilder()
      .setName('remove-item')
      .setDescription('Remove a custom server item (Admin only)')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('Name of the item to remove')
          .setRequired(true))
      .setDMPermission(false),

    new SlashCommandBuilder()
      .setName('view-items')
      .setDescription('View all custom server items (Admin only)')
      .setDMPermission(false),

    new SlashCommandBuilder()
      .setName('marble-game')
      .setDescription('Start a 4-player marble gambling game with cash betting')
      .addUserOption(option => 
        option.setName('player2')
          .setDescription('Second player to invite')
          .setRequired(true)
      )
      .addUserOption(option => 
        option.setName('player3')
          .setDescription('Third player to invite')
          .setRequired(true)
      )
      .addUserOption(option => 
        option.setName('player4')
          .setDescription('Fourth player to invite')
          .setRequired(true)
      )
      .setDMPermission(false),

    new SlashCommandBuilder()
      .setName('marble-duel')
      .setDescription('Challenge one player to a 1v1 marble duel with cash betting')
      .addUserOption(option =>
        option.setName('opponent')
          .setDescription('The player you want to duel')
          .setRequired(true)
      )
      .setDMPermission(false),

    new SlashCommandBuilder()
      .setName('convert')
      .setDescription('Convert your XP into cash (1 XP = $2)'),

    new SlashCommandBuilder()
      .setName('mining-status')
      .setDescription('Check current mining events and sector status'),

    new SlashCommandBuilder()
      .setName('observe')
      .setDescription("View another player's inventory and stats (requires their permission)")
      .addUserOption(option =>
        option.setName('player')
          .setDescription('The player you want to observe')
          .setRequired(true)),

    new SlashCommandBuilder()
      .setName('configure-observation')
      .setDescription('Set whether other players can view your inventory and stats'),

    new SlashCommandBuilder()
      .setName('collection')
      .setDescription('Browse your artefact field guide — see what you have and have not discovered'),

    new SlashCommandBuilder()
      .setName('give-roles')
      .setDescription('Assign a role to a server member (Admin only)')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('Member to assign a role to')
          .setRequired(true))
      .setDMPermission(false),

    new SlashCommandBuilder()
      .setName('timeout')
      .setDescription('Timeout a member (Admin only)')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to timeout')
          .setRequired(true))
      .addIntegerOption(option =>
        option.setName('duration')
          .setDescription('Timeout duration in minutes (max 40320 = 28 days)')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(40320))
      .addStringOption(option =>
        option.setName('reason')
          .setDescription('Reason for the timeout')
          .setRequired(false))
      .setDMPermission(false),

    new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kick a member from the server (Admin only)')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to kick')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('reason')
          .setDescription('Reason for the kick')
          .setRequired(false))
      .setDMPermission(false),

    new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Ban a member from the server (Admin only)')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to ban')
          .setRequired(true))
      .addIntegerOption(option =>
        option.setName('duration')
          .setDescription('Temporary ban duration in hours (leave empty or 0 for permanent)')
          .setRequired(false)
          .setMinValue(0))
      .addIntegerOption(option =>
        option.setName('delete_messages')
          .setDescription('Days of messages to delete (0–7, default 0)')
          .setRequired(false)
          .setMinValue(0)
          .setMaxValue(7))
      .addStringOption(option =>
        option.setName('reason')
          .setDescription('Reason for the ban')
          .setRequired(false))
      .setDMPermission(false),

  ];

  // Developer-only commands (registered separately)
  const devCommands = [
    new SlashCommandBuilder()
      .setName('give-artefact')
      .setDescription('Open an interactive menu to give artefacts to a user (Developer only)')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to give artefacts to')
          .setRequired(true)),

    new SlashCommandBuilder()
      .setName('give-cash')
      .setDescription('Give cash to a user (Developer only)')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to give cash to')
          .setRequired(true))
      .addIntegerOption(option =>
        option.setName('amount')
          .setDescription('Amount of cash to give')
          .setRequired(true)
          .setMinValue(1)),

    new SlashCommandBuilder()
      .setName('setevent')
      .setDescription('Manually trigger a mining event (Developer only)')
      .addStringOption(option =>
        option.setName('positive_artefact')
          .setDescription('Artefact that will have increased rates')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('negative_artefact')
          .setDescription('Artefact that will be unavailable')
          .setRequired(true)),

    new SlashCommandBuilder()
      .setName('remove-artefact')
      .setDescription('Remove an artefact from a user (Developer only)')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to remove artefact from')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('artefact')
          .setDescription('Name of the artefact to remove')
          .setRequired(true)),

    new SlashCommandBuilder()
      .setName('remove-cash')
      .setDescription('Remove cash from a user (Developer only)')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to remove cash from')
          .setRequired(true))
      .addIntegerOption(option =>
        option.setName('amount')
          .setDescription('Amount of cash to remove')
          .setRequired(true)
          .setMinValue(1)),

    new SlashCommandBuilder()
      .setName('reset-cooldowns')
      .setDescription('Reset cooldowns for a user or all users (Developer only)')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to reset cooldowns for (leave empty for ALL users)')
          .setRequired(false)),
    new SlashCommandBuilder()
      .setName('setprefix')
      .setDescription('Set the prefix for text-based commands in this server (Admin only)')
  ];

  const rest = new REST({ version:'10' }).setToken(token);

  try {
    console.log('Started refreshing application (/) commands.');

    // Register all commands globally (public + developer)
    // Developer commands will only work for authorized users due to permission checks
    await rest.put(Routes.applicationCommands(clientId), { 
      body: [...commands, ...devCommands].map(command => command.toJSON()) 
    });

    // Register developer commands for specific users only
    // This creates guild-specific commands that only appear for developers
    const guilds = client.guilds.cache;
    for (const [guildId, guild] of guilds) {
      try {
        // Fetch guild members if not cached
        if (!guild.members.cache.has(DEVELOPER_ID) && !guild.members.cache.has(CO_DEVELOPER_ID)) {
          try {
            await guild.members.fetch();
          } catch (fetchErr) {
            console.log(`Could not fetch members for guild ${guildId}`);
          }
        }

        // Check if developers are in this guild
        const hasDevelopers = guild.members.cache.has(DEVELOPER_ID) || 
                             guild.members.cache.has(CO_DEVELOPER_ID);

        if (hasDevelopers) {
          console.log(`Registering developer commands for guild: ${guild.name} (${guildId})`);
          await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
            body: [...commands, ...devCommands].map(command => command.toJSON())
          });
        } else {
          console.log(`No developers found in guild: ${guild.name} (${guildId})`);
          // Register only public commands for this guild
          await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
            body: commands.map(command => command.toJSON())
          });
        }
      } catch (guildErr) {
        console.error(`Error registering commands for guild ${guildId}:`, guildErr);
      }
    }

    console.log('Successfully reloaded application (/) commands.');
  } catch (err) { 
    console.error('Error registering commands:', err); 
  }
});

// Handle autocomplete interactions
client.on('interactionCreate', async interaction => {
  // Database not ready yet — respond gracefully instead of crashing
  if (!usersCollection) {
    if (interaction.isAutocomplete()) {
      await interaction.respond([]);
      return;
    }
    if (interaction.isRepliable()) {
      await interaction.reply({ content: 'The bot is still starting up, please try again in a moment.', ephemeral: true });
      return;
    }
    return;
  }

  if (interaction.isAutocomplete()) {
    const { commandName, focusedOption } = interaction;

    if (commandName === 'sell' && focusedOption.name === 'artefact') {
      const userId = interaction.user.id;
      const user = await getUser(userId);

      const userArtefacts = user.artefacts || [];
      const focusedValue = focusedOption.value.toLowerCase();

      const filtered = userArtefacts
        .filter(artefact => artefact.toLowerCase().includes(focusedValue))
        .slice(0, 25);

      await interaction.respond(
        filtered.map(artefact => ({ name: artefact, value: artefact }))
      );
      return;
    }
  }

  // Handle select menu interactions
  if (interaction.isStringSelectMenu()) {
    return await handleComponentInteraction(interaction);
  }

  // Handle button interactions
  if (interaction.isButton()) {
    return await handleComponentInteraction(interaction);
  }

  if (interaction.isModalSubmit()) {
    const { customId } = interaction;

    if (customId.startsWith('number_modal_')) {
      const gameId = customId.replace('number_modal_', '');
      await processNumberGuess(interaction, gameId);
      return;
    }

    if (customId.startsWith('bet_modal_')) {
      const gameId = customId.replace('bet_modal_', '');
      await handleBetModalSubmit(interaction, gameId);
      return;
    }

    if (customId.startsWith('duel_number_modal_')) {
      const gameId = customId.replace('duel_number_modal_', '');
      await processDuelGuess(interaction, gameId);
      return;
    }

    if (customId.startsWith('duel_bet_modal_')) {
      const gameId = customId.replace('duel_bet_modal_', '');
      await handleDuelBetModal(interaction, gameId);
      return;
    }

    if (customId.startsWith('ms_amount_modal_')) {
      const sessionId = customId.replace('ms_amount_modal_', '');
      const session = global.massSellSessions[sessionId];

      if (!session) {
        return await interaction.reply({ content: 'This session has expired.', ephemeral: true });
      }

      const rawAmount = interaction.fields.getTextInputValue('ms_amount_input');
      const amount = parseInt(rawAmount);

      if (isNaN(amount) || amount < 1) {
        return await interaction.reply({ content: 'Please enter a valid number of 1 or more.', ephemeral: true });
      }

      const user = await getUser(session.userId);

      // Count how many are available (owned minus already queued)
      const owned = user.artefacts.filter(a => a === session.selectedArtefact).length;
      const alreadyQueued = session.queue.find(e => e.name === session.selectedArtefact)?.amount || 0;
      const available = owned - alreadyQueued;

      if (amount > available) {
        return await interaction.reply({
          content: `You only have **${available}** available copies of ${session.selectedArtefact} to queue.`,
          ephemeral: true
        });
      }

      const existing = session.queue.find(e => e.name === session.selectedArtefact);
      if (existing) {
        existing.amount += amount;
      } else {
        session.queue.push({ name: session.selectedArtefact, amount });
      }

      await interaction.deferUpdate();
      await session.message.edit({
        embeds: [buildMassSellEmbed(session, user.artefacts)],
        components: buildMassSellComponents(sessionId, session, user.artefacts)
      });
      return;
    }

    if (customId.startsWith('ga_amount_modal_')) {
      const sessionId = customId.replace('ga_amount_modal_', '');
      const session = global.giveArtefactSessions[sessionId];

      if (!session) {
        return await interaction.reply({ content: 'This session has expired.', ephemeral: true });
      }

      const rawAmount = interaction.fields.getTextInputValue('ga_amount_input');
      const amount = parseInt(rawAmount);

      if (isNaN(amount) || amount < 1 || amount > 1000) {
        return await interaction.reply({ content: 'Please enter a valid number between 1 and 1000.', ephemeral: true });
      }

      const existing = session.queue.find(e => e.name === session.selectedArtefact);
      if (existing) {
        existing.amount += amount;
      } else {
        session.queue.push({ name: session.selectedArtefact, amount });
      }

      await interaction.deferUpdate();
      await session.message.edit({
        embeds: [buildGiveArtefactEmbed(session)],
        components: buildGiveArtefactComponents(sessionId, session)
      });
      return;
    }

    if (customId === 'setprefix_modal') {
      await handleSetPrefixModal(interaction);
      return;
    }
  }

  if (!interaction.isChatInputCommand()) return;

  // Acknowledge ALL commands immediately to prevent timeout  
  if (interaction.commandName === 'store' || interaction.commandName === 'buy' || interaction.commandName === 'add-item') {
    await interaction.deferReply();
  }

  // Developer commands get ephemeral replies
  if (interaction.commandName === 'reset-cooldowns') {
    await interaction.deferReply({ ephemeral: true });
  }

  const userId = interaction.user.id;
  // Load user data from database before processing any command
  await getUser(userId);

  // Increment command counter (persisted on next natural save)
  if (!userData[userId].commandCount) userData[userId].commandCount = 0;
  userData[userId].commandCount++;

  // Seed joinedDate for existing users who predate the field
  if (!userData[userId].joinedDate) {
    userData[userId].joinedDate = Date.now();
  }

  try {
    switch (interaction.commandName) {
      case 'info':
        await handleInfoCommand(interaction);
        break;
      case 'setprefix':
        await handleSetPrefixCommand(interaction);
        break;
      case 'bank':
        await handleBankCommand(interaction, userId);
        break;

      case 'bank-all':
        await handleBankAllCommand(interaction, userId);
        break;
      case 'withdraw':
        await handleWithdrawCommand(interaction, userId);
        break;
      case 'steal':
        await handleStealCommand(interaction, userId);
        break;
      case 'scavenge':
        await handleScavengeCommand(interaction, userId);
        break;
      case 'labor':
        await handleLaborCommand(interaction, userId);
        break;
      case 'inventory':
        await handleInventoryCommand(interaction, userId);
        break;
      case 'sell':
        break;
      case 'trade':
        await handleTradeCommand(interaction, userId);
        break;
      case 'leaderboard':
        await handleLeaderboardCommand(interaction);
        break;
      case 'store':
        await handleStoreCommand(interaction);
        break;
      case 'buy':
        await handleBuyCommand(interaction, userId);
        break;
      case 'mass-sell':
        await handleMassSellCommand(interaction, userId);
        break;
      case 'add-item':
        await handleAddItemCommand(interaction);
        break;
      case 'remove-item':
        await handleRemoveItemCommand(interaction);
        break;
      case 'view-items':
        await handleViewItemsCommand(interaction);
        break;

      case 'marble-game':
        await handleMarbleGame(interaction);
        break;

      case 'marble-duel':
        await handleMarbleDuel(interaction);
        break;

      case 'convert':
        await handleConvertCommand(interaction, userId);
        break;

      case 'mining-status':
        await handleMiningStatusCommand(interaction);
        break;

      case 'give-artefact':
        await handleGiveArtefactCommand(interaction);
        break;

      case 'give-cash':
        await handleGiveCashCommand(interaction);
        break;

      case 'setevent':
        await handleSetEventCommand(interaction);
        break;

      case 'remove-artefact':
        await handleRemoveArtefactCommand(interaction);
        break;

      case 'remove-cash':
        await handleRemoveCashCommand(interaction);
        break;

      case 'reset-cooldowns':
        await handleResetCooldownsCommand(interaction);
        break;

      case 'observe':
        await handleObserveCommand(interaction, userId);
        break;

      case 'configure-observation':
        await handleConfigureObservationCommand(interaction, userId);
        break;

      case 'collection':
        await handleCollectionCommand(interaction, userId);
        break;

      case 'give-roles':
        await handleGiveRolesCommand(interaction);
        break;

      case 'timeout':
        await handleTimeoutCommand(interaction);
        break;

      case 'kick':
        await handleKickCommand(interaction);
        break;

      case 'ban':
        await handleBanCommand(interaction);
        break;
    }
  } catch (error) {
    console.error('Error handling slash command:', error);

    try {
      const errorEmbed = new EmbedBuilder()
        .setTitle('Command Error')
        .setDescription('An error occurred while processing your command. Please try again.')
        .setColor(0xFF6B6B)
        .setTimestamp();

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ embeds: [errorEmbed], flags: 64 });
      } else if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({ embeds: [errorEmbed] });
      }
    } catch (replyError) {
      console.error('Failed to send error message:', replyError);
    }
  }
});

// === MODERATION COMMAND HANDLERS ===

async function handleGiveRolesCommand(interaction) {
  if (!isDeveloper(interaction.user.id) && !interaction.member?.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Access Denied')
          .setDescription('You need **Administrator** permissions or must be a bot developer to use this command.')
          .setColor(0xFF6B6B)
          .setTimestamp()
      ],
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const targetMember = interaction.options.getMember('user');
  if (!targetMember) {
    return interaction.editReply({ content: 'That user was not found in this server.' });
  }

  try {
    await interaction.guild.roles.fetch();
    await targetMember.fetch();
  } catch (e) {
    console.error('Failed to fetch data:', e);
  }

  const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe().catch(() => null);
  if (!botMember) {
    return interaction.editReply({ content: 'Unable to retrieve bot member data.' });
  }

  const botHighestRole = botMember.roles.highest;

  // ALL roles except @everyone, sorted highest to lowest
  const allRoles = [...interaction.guild.roles.cache
    .filter(role => role.id !== interaction.guild.id)
    .sort((a, b) => b.position - a.position)
    .values()];

  if (allRoles.length === 0) {
    return interaction.editReply({ content: 'This server has no roles.' });
  }

  const PAGE_SIZE = 25;
  let currentPage = 0;
  let mode = 'add'; // 'add' or 'remove'

  function canManage(role) {
    return role.position < botHighestRole.position && !role.managed;
  }

  function getMemberRoles() {
    return targetMember.roles.cache
      .filter(r => r.id !== interaction.guild.id)
      .sort((a, b) => b.position - a.position);
  }

  function buildEmbed(page) {
    const totalPages = Math.ceil(allRoles.length / PAGE_SIZE);
    const start = page * PAGE_SIZE + 1;
    const end = Math.min((page + 1) * PAGE_SIZE, allRoles.length);

    const memberRoles = getMemberRoles();
    const roleList = memberRoles.size > 0
      ? [...memberRoles.values()].map(r => `<@&${r.id}>`).join(' ')
      : '*No roles assigned*';

    const modeColor = mode === 'add' ? 0x57F287 : 0xFF6B6B;
    const modeLabel = mode === 'add' ? '➕ Add Role' : '➖ Remove Role';

    return new EmbedBuilder()
      .setTitle(`Role Manager — ${targetMember.displayName}`)
      .setThumbnail(targetMember.user.displayAvatarURL({ dynamic: true }))
      .setDescription(
        `**Target:** <@${targetMember.id}>\n` +
        `**Mode:** ${modeLabel}\n\n` +
        `**Current Roles (${memberRoles.size}):**\n${roleList}`
      )
      .addFields({
        name: `All Server Roles — Page ${page + 1} / ${totalPages}`,
        value: `Showing **${start}–${end}** of **${allRoles.length}** roles.\n` +
               `⚠️ = above bot (cannot manage) • 🔒 = managed/integration`
      })
      .setColor(modeColor)
      .setFooter({ text: `Menu expires in 2 minutes • Bot\'s highest role: ${botHighestRole.name}` })
      .setTimestamp();
  }

  function buildComponents(page) {
    const totalPages = Math.ceil(allRoles.length / PAGE_SIZE);
    const pageRoles = allRoles.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    const placeholder = mode === 'add'
      ? 'Select role(s) to add...'
      : 'Select role(s) to remove...';

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`gr_select_${interaction.id}`)
      .setPlaceholder(placeholder)
      .setMinValues(1)
      .setMaxValues(pageRoles.length)
      .addOptions(pageRoles.map(role => {
        const memberHas = targetMember.roles.cache.has(role.id);
        const manageable = canManage(role);
        let statusIcon = manageable ? (memberHas ? '✅' : '◻️') : (role.managed ? '🔒' : '⚠️');
        let desc = ``;
        if (!manageable && role.managed) desc = 'Managed by integration';
        else if (!manageable) desc = 'Above bot — cannot assign';
        else if (memberHas) desc = 'Member already has this role';
        else desc = `Position ${role.position} • ${role.hexColor}`;

        return {
          label: `${statusIcon} ${role.name}`.substring(0, 100),
          value: role.id,
          description: desc.substring(0, 100)
        };
      }));

    const rows = [new ActionRowBuilder().addComponents(selectMenu)];

    // Mode toggle + pagination row
    const addBtn = new ButtonBuilder()
      .setCustomId(`gr_mode_add_${interaction.id}`)
      .setLabel('➕ Add')
      .setStyle(mode === 'add' ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(mode === 'add');

    const removeBtn = new ButtonBuilder()
      .setCustomId(`gr_mode_remove_${interaction.id}`)
      .setLabel('➖ Remove')
      .setStyle(mode === 'remove' ? ButtonStyle.Danger : ButtonStyle.Secondary)
      .setDisabled(mode === 'remove');

    const prevBtn = new ButtonBuilder()
      .setCustomId(`gr_prev_${interaction.id}`)
      .setLabel('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0);

    const pageBtn = new ButtonBuilder()
      .setCustomId(`gr_page_${interaction.id}`)
      .setLabel(`${page + 1} / ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const nextBtn = new ButtonBuilder()
      .setCustomId(`gr_next_${interaction.id}`)
      .setLabel('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === totalPages - 1);

    rows.push(new ActionRowBuilder().addComponents(addBtn, removeBtn, prevBtn, pageBtn, nextBtn));

    return rows;
  }

  const reply = await interaction.editReply({
    embeds: [buildEmbed(0)],
    components: buildComponents(0),
    fetchReply: true
  });

  const collector = reply.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id,
    time: 120000
  });

  collector.on('collect', async i => {
    if (i.customId === `gr_prev_${interaction.id}`) {
      currentPage = Math.max(0, currentPage - 1);
      await i.update({ embeds: [buildEmbed(currentPage)], components: buildComponents(currentPage) });

    } else if (i.customId === `gr_next_${interaction.id}`) {
      const totalPages = Math.ceil(allRoles.length / PAGE_SIZE);
      currentPage = Math.min(totalPages - 1, currentPage + 1);
      await i.update({ embeds: [buildEmbed(currentPage)], components: buildComponents(currentPage) });

    } else if (i.customId === `gr_mode_add_${interaction.id}`) {
      mode = 'add';
      await i.update({ embeds: [buildEmbed(currentPage)], components: buildComponents(currentPage) });

    } else if (i.customId === `gr_mode_remove_${interaction.id}`) {
      mode = 'remove';
      await i.update({ embeds: [buildEmbed(currentPage)], components: buildComponents(currentPage) });

    } else if (i.customId === `gr_select_${interaction.id}`) {
      const selectedIds = i.values;
      const succeeded = [];
      const skipped = [];
      const failed = [];

      for (const roleId of selectedIds) {
        const role = interaction.guild.roles.cache.get(roleId);
        const roleName = role ? `\`${role.name}\`` : `\`${roleId}\``;

        if (!role || !canManage(role)) {
          failed.push(`${roleName} *(unmanageable)*`);
          continue;
        }

        if (mode === 'add') {
          if (targetMember.roles.cache.has(roleId)) {
            skipped.push(`${roleName} *(already has)*`);
            continue;
          }
          try {
            await targetMember.roles.add(roleId, `Added by ${interaction.user.tag} via /give-roles`);
            succeeded.push(roleName);
          } catch (err) {
            console.error(`Failed to add role ${roleId}:`, err);
            failed.push(`${roleName} *(error)*`);
          }
        } else {
          if (!targetMember.roles.cache.has(roleId)) {
            skipped.push(`${roleName} *(doesn't have)*`);
            continue;
          }
          try {
            await targetMember.roles.remove(roleId, `Removed by ${interaction.user.tag} via /give-roles`);
            succeeded.push(roleName);
          } catch (err) {
            console.error(`Failed to remove role ${roleId}:`, err);
            failed.push(`${roleName} *(error)*`);
          }
        }
      }

      // Refresh member roles after change
      try { await targetMember.fetch(); } catch (_) {}

      const actionWord = mode === 'add' ? 'Added' : 'Removed';
      const lines = [];
      if (succeeded.length) lines.push(`✅ **${actionWord}:** ${succeeded.join(', ')}`);
      if (skipped.length) lines.push(`ℹ️ **Skipped:** ${skipped.join(', ')}`);
      if (failed.length) lines.push(`❌ **Failed:** ${failed.join(', ')}`);

      const updatedRoles = getMemberRoles();
      const updatedRoleList = updatedRoles.size > 0
        ? [...updatedRoles.values()].map(r => `<@&${r.id}>`).join(' ')
        : '*No roles*';

      const confirmEmbed = new EmbedBuilder()
        .setTitle(`Roles Updated — ${targetMember.displayName}`)
        .setThumbnail(targetMember.user.displayAvatarURL({ dynamic: true }))
        .setDescription(lines.join('\n'))
        .addFields({ name: 'Current Roles', value: updatedRoleList })
        .setColor(succeeded.length ? (mode === 'add' ? 0x57F287 : 0xFF6B6B) : 0x99AAB5)
        .setTimestamp();

      // Keep menu open so they can keep managing
      await i.update({ embeds: [confirmEmbed, buildEmbed(currentPage)], components: buildComponents(currentPage) });
    }
  });

  collector.on('end', (_, reason) => {
    if (reason === 'time') {
      interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('Session Expired')
            .setDescription(`Role management session for <@${targetMember.id}> ended after 2 minutes of inactivity.`)
            .setColor(0x99AAB5)
            .setTimestamp()
        ],
        components: []
      }).catch(() => {});
    }
  });
}

async function handleTimeoutCommand(interaction) {
  if (!isDeveloper(interaction.user.id) && !interaction.member?.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Access Denied')
          .setDescription('You need **Administrator** permissions or must be a bot developer to use this command.')
          .setColor(0xFF6B6B)
          .setTimestamp()
      ],
      ephemeral: true
    });
  }

  const target = interaction.options.getMember('user');
  const durationMinutes = interaction.options.getInteger('duration');
  const reason = interaction.options.getString('reason') || 'No reason provided';

  if (!target) {
    return interaction.reply({ content: 'That user was not found in this server.', ephemeral: true });
  }
  if (target.id === interaction.user.id) {
    return interaction.reply({ content: 'You cannot timeout yourself.', ephemeral: true });
  }
  if (target.id === interaction.client.user.id) {
    return interaction.reply({ content: 'I cannot timeout myself.', ephemeral: true });
  }
  if (!target.moderatable) {
    return interaction.reply({ content: 'I cannot timeout this user — they may have higher permissions than me.', ephemeral: true });
  }

  const durationMs = durationMinutes * 60 * 1000;

  let durationLabel;
  if (durationMinutes < 60) {
    durationLabel = `${durationMinutes} minute(s)`;
  } else if (durationMinutes < 1440) {
    durationLabel = `${Math.round(durationMinutes / 60 * 10) / 10} hour(s)`;
  } else {
    durationLabel = `${Math.round(durationMinutes / 1440 * 10) / 10} day(s)`;
  }

  await target.timeout(durationMs, reason);

  const embed = new EmbedBuilder()
    .setTitle('Member Timed Out')
    .setDescription(`<@${target.id}> has been timed out.`)
    .addFields(
      { name: 'Duration', value: durationLabel, inline: true },
      { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Reason', value: reason }
    )
    .setColor(0xFFA500)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleKickCommand(interaction) {
  if (!isDeveloper(interaction.user.id) && !interaction.member?.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Access Denied')
          .setDescription('You need **Administrator** permissions or must be a bot developer to use this command.')
          .setColor(0xFF6B6B)
          .setTimestamp()
      ],
      ephemeral: true
    });
  }

  const target = interaction.options.getMember('user');
  const reason = interaction.options.getString('reason') || 'No reason provided';

  if (!target) {
    return interaction.reply({ content: 'That user was not found in this server.', ephemeral: true });
  }
  if (target.id === interaction.user.id) {
    return interaction.reply({ content: 'You cannot kick yourself.', ephemeral: true });
  }
  if (target.id === interaction.client.user.id) {
    return interaction.reply({ content: 'I cannot kick myself.', ephemeral: true });
  }
  if (!target.kickable) {
    return interaction.reply({ content: 'I cannot kick this user — they may have higher permissions than me.', ephemeral: true });
  }

  await target.kick(reason);

  const embed = new EmbedBuilder()
    .setTitle('Member Kicked')
    .setDescription(`<@${target.id}> has been kicked from the server.`)
    .addFields(
      { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Reason', value: reason }
    )
    .setColor(0xFF6B6B)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleBanCommand(interaction) {
  if (!isDeveloper(interaction.user.id) && !interaction.member?.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Access Denied')
          .setDescription('You need **Administrator** permissions or must be a bot developer to use this command.')
          .setColor(0xFF6B6B)
          .setTimestamp()
      ],
      ephemeral: true
    });
  }

  const target = interaction.options.getMember('user');
  const durationHours = interaction.options.getInteger('duration') ?? 0;
  const deleteMessages = interaction.options.getInteger('delete_messages') ?? 0;
  const reason = interaction.options.getString('reason') || 'No reason provided';

  if (!target) {
    return interaction.reply({ content: 'That user was not found in this server.', ephemeral: true });
  }
  if (target.id === interaction.user.id) {
    return interaction.reply({ content: 'You cannot ban yourself.', ephemeral: true });
  }
  if (target.id === interaction.client.user.id) {
    return interaction.reply({ content: 'I cannot ban myself.', ephemeral: true });
  }
  if (!target.bannable) {
    return interaction.reply({ content: 'I cannot ban this user — they may have higher permissions than me.', ephemeral: true });
  }

  const durationLabel = durationHours === 0 ? 'Permanent' : `${durationHours} hour(s)`;
  const targetId = target.id;
  const guild = interaction.guild;

  await target.ban({ deleteMessageSeconds: deleteMessages * 86400, reason });

  const embed = new EmbedBuilder()
    .setTitle('Member Banned')
    .setDescription(`<@${targetId}> has been banned from the server.`)
    .addFields(
      { name: 'Duration', value: durationLabel, inline: true },
      { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Messages Deleted', value: `${deleteMessages} day(s)`, inline: true },
      { name: 'Reason', value: reason }
    )
    .setColor(0x8B0000)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });

  if (durationHours > 0) {
    setTimeout(async () => {
      try {
        await guild.members.unban(targetId, 'Temporary ban expired');
        console.log(`Auto-unbanned user ${targetId} from ${guild.name} after ${durationHours} hour(s).`);
      } catch (err) {
        console.error(`Failed to auto-unban user ${targetId}:`, err);
      }
    }, durationHours * 60 * 60 * 1000);
  }
}

// Command handlers
async function handleSetPrefixCommand(interaction) {
  if (!isDeveloper(interaction.user.id) && !interaction.member?.permissions.has(PermissionFlagsBits.Administrator)) {
    return await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('Access Denied')
        .setDescription('You need **Administrator** permissions or must be a bot developer to use this command.')
        .setColor(0xFF6B6B)
        .setTimestamp()],
      ephemeral: true
    });
  }
  if (!interaction.guildId) {
    return await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
  }

  const currentPrefix = await getGuildPrefix(interaction.guildId);

  const input = new TextInputBuilder()
    .setCustomId('setprefix_input')
    .setLabel('New prefix (1-5 chars, no spaces)')
    .setPlaceholder('e.g.  !   $   fb!')
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(5)
    .setRequired(true);

  if (currentPrefix) input.setValue(currentPrefix);

  const modal = new ModalBuilder()
    .setCustomId('setprefix_modal')
    .setTitle('Set Server Prefix')
    .addComponents(new ActionRowBuilder().addComponents(input));

  await interaction.showModal(modal);
}

async function handleSetPrefixModal(interaction) {
  if (!isDeveloper(interaction.user.id) && !interaction.member?.permissions.has(PermissionFlagsBits.Administrator)) {
    return await interaction.reply({ content: 'You no longer have permission to set the prefix.', ephemeral: true });
  }
  if (!interaction.guildId) {
    return await interaction.reply({ content: 'This can only be used in a server.', ephemeral: true });
  }

  const raw = interaction.fields.getTextInputValue('setprefix_input');
  const validation = validatePrefix(raw);
  if (!validation.ok) {
    return await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('Invalid Prefix')
        .setDescription(validation.reason)
        .setColor(0xFF6B6B)
        .setTimestamp()],
      ephemeral: true
    });
  }

  try {
    await setGuildPrefix(interaction.guildId, validation.prefix);
  } catch (err) {
    console.error('Failed to save guild prefix:', err);
    return await interaction.reply({ content: 'Failed to save the prefix. Please try again later.', ephemeral: true });
  }

  return await interaction.reply({
    embeds: [new EmbedBuilder()
      .setTitle('Prefix Updated')
      .setDescription(`The text-command prefix for this server is now: \`${validation.prefix}\``)
      .addFields({
        name: 'Try it',
        value: `\`${validation.prefix}inventory\`, \`${validation.prefix}labor\`, \`${validation.prefix}bank all\`, \`${validation.prefix}store\`, \`${validation.prefix}scavenge\``
      })
      .setColor(0x51CF66)
      .setTimestamp()]
  });
}

class MessageInteractionAdapter {
  constructor(message, args, commandName) {
    this.message = message;
    this.user = message.author;
    this.member = message.member;
    this.guild = message.guild;
    this.guildId = message.guildId;
    this.channel = message.channel;
    this.channelId = message.channelId;
    this.commandName = commandName;
    this.replied = false;
    this.deferred = false;
    this._reply = null;
    this.options = {
      _args: args,
      getInteger: (_name) => {
        const raw = args[0];
        if (raw === undefined || raw === null) return null;
        const n = parseInt(String(raw).replace(/[, $_]/g, ''), 10);
        return isNaN(n) ? null : n;
      },
      getString: (_name) => (args[0] !== undefined ? String(args[0]) : null),
      getUser: (_name) => message.mentions.users.first() || null,
      getBoolean: (_name) => null,
    };
  }

  isRepliable() { return true; }
  isAutocomplete() { return false; }
  isChatInputCommand() { return false; }

  _normalizePayload(payload) {
    if (typeof payload === 'string') return { content: payload };
    const out = {};
    if (payload.embeds) out.embeds = payload.embeds;
    if (payload.content) out.content = payload.content;
    if (payload.components) out.components = payload.components;
    if (payload.files) out.files = payload.files;
    if (!out.content && !out.embeds && !out.components && !out.files) {
      out.content = '\u200b';
    }
    return out;
  }

  async deferReply(_opts = {}) {
    if (this.deferred || this.replied) return this._reply;
    try {
      this._reply = await this.message.channel.send({ content: 'Working on it…' });
    } catch (err) {
      console.error('deferReply send failed:', err);
    }
    this.deferred = true;
    return this._reply;
  }

  async reply(payload) {
    if (this.replied || this.deferred) {
      return await this.editReply(payload);
    }
    const sendPayload = this._normalizePayload(payload);
    try {
      this._reply = await this.message.reply(sendPayload);
    } catch (err) {
      try {
        this._reply = await this.message.channel.send(sendPayload);
      } catch (err2) {
        console.error('reply failed entirely:', err2);
      }
    }
    this.replied = true;
    return this._reply;
  }

  async editReply(payload) {
    const sendPayload = this._normalizePayload(payload);
    if (this._reply) {
      try {
        return await this._reply.edit(sendPayload);
      } catch (err) {
        try {
          return await this.message.channel.send(sendPayload);
        } catch (err2) {
          console.error('editReply fallback failed:', err2);
        }
      }
    }
    try {
      this._reply = await this.message.channel.send(sendPayload);
    } catch (err) {
      console.error('editReply send failed:', err);
    }
    this.replied = true;
    return this._reply;
  }

  async followUp(payload) {
    const sendPayload = this._normalizePayload(payload);
    try {
      return await this.message.channel.send(sendPayload);
    } catch (err) {
      console.error('followUp send failed:', err);
    }
  }

  async showModal(_modal) {
    // Modals require an interaction context; not supported from message-based commands.
    try {
      await this.message.reply('This action requires using the slash-command version.');
    } catch (_) {}
  }
}

async function dispatchPrefixCommand(message, tokens) {
  const cmd = tokens[0].toLowerCase();
  const args = tokens.slice(1);

  let handler = null;
  let commandName = null;
  let parsedArgs = args;

  switch (cmd) {
    case 'labor':
    case 'work':
      handler = (ix) => handleLaborCommand(ix, message.author.id);
      commandName = 'labor';
      break;

    case 'inventory':
    case 'inv':
      handler = (ix) => handleInventoryCommand(ix, message.author.id);
      commandName = 'inventory';
      break;

    case 'scavenge':
    case 'scav':
      handler = (ix) => handleScavengeCommand(ix, message.author.id);
      commandName = 'scavenge';
      break;

    case 'store':
    case 'shop':
      handler = async (ix) => {
        await ix.deferReply();
        await handleStoreCommand(ix);
      };
      commandName = 'store';
      break;

    case 'leaderboard':
    case 'lb':
      handler = (ix) => handleLeaderboardCommand(ix);
      commandName = 'leaderboard';
      break;

    case 'mining-status':
    case 'mining':
    case 'event':
      handler = (ix) => handleMiningStatusCommand(ix);
      commandName = 'mining-status';
      break;

    case 'collection':
    case 'col':
      handler = (ix) => handleCollectionCommand(ix, message.author.id);
      commandName = 'collection';
      break;

    case 'bank':
      if ((args[0] || '').toLowerCase() === 'all') {
        handler = (ix) => handleBankAllCommand(ix, message.author.id);
        commandName = 'bank-all';
      } else if (args[0]) {
        const amount = parseInt(String(args[0]).replace(/[, $_]/g, ''), 10);
        if (isNaN(amount) || amount <= 0) {
          try { await message.reply('Usage: `bank <amount>` or `bank all`'); } catch (_) {}
          return true;
        }
        parsedArgs = [String(amount)];
        handler = (ix) => handleBankCommand(ix, message.author.id);
        commandName = 'bank';
      } else {
        try { await message.reply('Usage: `bank <amount>` or `bank all`'); } catch (_) {}
        return true;
      }
      break;

    case 'withdraw':
    case 'wd':
      if (args[0]) {
        const amount = parseInt(String(args[0]).replace(/[, $_]/g, ''), 10);
        if (isNaN(amount) || amount <= 0) {
          try { await message.reply('Usage: `withdraw <amount>`'); } catch (_) {}
          return true;
        }
        parsedArgs = [String(amount)];
        handler = (ix) => handleWithdrawCommand(ix, message.author.id);
        commandName = 'withdraw';
      } else {
        try { await message.reply('Usage: `withdraw <amount>`'); } catch (_) {}
        return true;
      }
      break;

    default:
      return false;
  }

  try {
    const userId = message.author.id;
    await getUser(userId);
    if (!userData[userId].commandCount) userData[userId].commandCount = 0;
    userData[userId].commandCount++;
    if (!userData[userId].joinedDate) userData[userId].joinedDate = Date.now();

    const adapter = new MessageInteractionAdapter(message, parsedArgs, commandName);
    await handler(adapter);
  } catch (err) {
    console.error(`Prefix command "${cmd}" failed:`, err);
    try {
      await message.reply('Something went wrong while running that command. Please try again.');
    } catch (_) {}
  }
  return true;
}


async function handleInfoCommand(interaction) {
  const guildPrefix = interaction.guildId ? await getGuildPrefix(interaction.guildId) : null;
  const prefixNote = guildPrefix
    ? `**Text-command prefix for this server:** \`${guildPrefix}\`\nMost common commands also work as e.g. \`${guildPrefix}inventory\`, \`${guildPrefix}labor\`, \`${guildPrefix}bank all\`.`
    : 'No text-command prefix set yet — admins can set one with `/setprefix`, then players can use commands like `!inventory` instead of slash.';

  const infoEmbed = new EmbedBuilder()
    .setTitle('Fortune Bot — Build Your Empire')
    .setDescription(
      '**Welcome to Fortune Bot!** Earn cash, scavenge for rare artefacts, trade with players, ' +
      'fight in marble games, and climb the leaderboards.\n\n' + prefixNote
    )
    .setColor(0x2F3136)
    .addFields(
      {
        name: 'Earning & Inventory',
        value: [
          '`/scavenge` — Search for rare artefacts (cooldown applies)',
          '`/labor` — Work to earn cash (cooldown applies)',
          '`/inventory` — View your cash, bank balance, and artefact collection',
          '`/collection` — Browse your full artefact collection',
          '`/convert` — Convert XP into cash (1 XP = $2)'
        ].join('\n'),
        inline: false
      },
      {
        name: 'Banking',
        value: [
          '`/bank <amount>` — Deposit cash into your bank',
          '`/bank-all` — Deposit all your cash at once',
          '`/withdraw <amount>` — Withdraw cash from your bank',
          'Use `/store` then `/buy Bank Expansion Ticket` to grow your bank capacity (+25% per ticket).'
        ].join('\n'),
        inline: false
      },
      {
        name: 'Trading & Selling',
        value: [
          '`/sell` — Open the interactive sell menu',
          '`/mass-sell` — Queue and sell many artefacts at once',
          '`/trade <user>` — Start an interactive trade with another player',
          '`/store` — View global and server-specific items for sale',
          '`/buy <item>` — Purchase an item from the store'
        ].join('\n'),
        inline: false
      },
      {
        name: 'Player Interaction',
        value: [
          '`/steal <user> <amount>` — Steal cash on hand from a player (bank balances are protected)',
          '`/marble-game` — Multiplayer marble guessing game',
          '`/marble-duel <opponent>` — 1v1 marble duel for stakes',
          '`/leaderboard` — View server wealth rankings',
          '`/observe <player>` — View another player\'s inventory (with their permission)',
          '`/configure-observation` — Toggle whether others can observe you'
        ].join('\n'),
        inline: false
      },
      {
        name: 'Events',
        value: [
          '`/mining-status` — Check the current Mining Crisis event',
          'During a Mining Crisis one artefact becomes unscavengeable while another doubles in find rate.'
        ].join('\n'),
        inline: false
      },
      {
        name: 'Server Admins',
        value: [
          '`/setprefix` — Set the text-command prefix for this server',
          '`/add-item`, `/remove-item`, `/view-items` — Manage server-specific store items',
          '`/give-roles`, `/timeout`, `/kick`, `/ban` — Moderation tools'
        ].join('\n'),
        inline: false
      },
      {
        name: 'Artefact Rarity & Tier Scaling',
        value: [
          '**Common** (65%) · **Uncommon** (20%) · **Rare** (10%) · **Legendary** (4%) · **Unknown** (1%)',
          'Each artefact has a tier (T1–T5) that scales its sell value: T1=65%  T2=75%  T3=100%  T4=125%  T5=135%.',
          'Shiny variants (✨) sell for 20× the base tier value.'
        ].join('\n'),
        inline: false
      }
    )
    .setFooter({ text: 'Tip: Start with /scavenge to find your first artefact!' })
    .setTimestamp();

  await interaction.reply({ embeds: [infoEmbed] });
}

// Banking command handlers
async function handleBankCommand(interaction, userId) {
  const amount = interaction.options.getInteger('amount');

  const currentBank = userData[userId].bankBalance || 0;
  const bankCapacity = await calculateBankCapacity(userId);
  const maxDeposit = bankCapacity - currentBank;

  // Check bank capacity
  if (amount > maxDeposit) {
    const expansions = userData[userId].bankExpansions || 0;
    const capacityEmbed = new EmbedBuilder()
      .setTitle('Bank Capacity Exceeded')
      .setDescription('Your deposit would exceed the maximum bank capacity.')
      .addFields(
        { name: 'Maximum Deposit Available', value: `$${maxDeposit.toLocaleString()}`, inline: true },
        { name: 'Current Bank Balance', value: `$${currentBank.toLocaleString()}`, inline: true },
        { name: 'Bank Capacity', value: `$${bankCapacity.toLocaleString()}`, inline: true },
        { name: 'Bank Usage', value: `${((currentBank / bankCapacity) * 100).toFixed(1)}%`, inline: true },
        { name: 'Expansions Purchased', value: `${expansions}`, inline: true },
        { name: 'Upgrade Available', value: 'Use `/store` to buy Bank Expansion Tickets', inline: true }
      )
      .setColor(0xFF9F43)
      .setTimestamp();

    return await interaction.reply({ embeds: [capacityEmbed] });
  }

  // Check sufficient cash
  if (userData[userId].cash < amount) {
    const insufficientEmbed = new EmbedBuilder()
      .setTitle('Insufficient Cash')
      .setDescription('You do not have enough cash on hand for this deposit.')
      .addFields(
        { name: 'Available Cash', value: `$${userData[userId].cash.toLocaleString()}`, inline: true },
        { name: 'Attempted Deposit', value: `$${amount.toLocaleString()}`, inline: true },
        { name: 'Shortfall', value: `$${(amount - userData[userId].cash).toLocaleString()}`, inline: true }
      )
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.reply({ embeds: [insufficientEmbed] });
  }

  // Process deposit
  userData[userId].cash -= amount;
  userData[userId].bankBalance = currentBank + amount;
  await saveUserData();

  const finalCapacity = await calculateBankCapacity(userId);
  const expansions = userData[userId].bankExpansions || 0;
  const successEmbed = new EmbedBuilder()
    .setTitle('Bank Deposit Completed')
    .setDescription(`Successfully deposited $${amount.toLocaleString()} into your secure bank account.`)
    .addFields(
      { name: 'Transaction Amount', value: `$${amount.toLocaleString()}`, inline: true },
      { name: 'Remaining Cash', value: `$${userData[userId].cash.toLocaleString()}`, inline: true },
      { name: 'New Bank Balance', value: `$${userData[userId].bankBalance.toLocaleString()}`, inline: true },
      { name: 'Bank Capacity Used', value: `${((userData[userId].bankBalance / finalCapacity) * 100).toFixed(1)}%`, inline: true },
      { name: 'Available Space', value: `$${(finalCapacity - userData[userId].bankBalance).toLocaleString()}`, inline: true },
      { name: 'Expansions Owned', value: `${expansions}`, inline: true }
    )
    .setColor(0x00FF7F)
    .setFooter({ text: 'Your banked money is safe from theft attempts' })
    .setTimestamp();

  await interaction.reply({ embeds: [successEmbed] });
}

async function handleBankAllCommand(interaction, userId) {
  const cash = userData[userId].cash || 0;

  if (cash <= 0) {
    const noFundsEmbed = new EmbedBuilder()
      .setTitle('No Cash to Deposit')
      .setDescription('You have no cash on hand to deposit.')
      .addFields(
        { name: 'Cash on Hand', value: `$0`, inline: true },
        { name: 'Bank Balance', value: `$${(userData[userId].bankBalance || 0).toLocaleString()}`, inline: true }
      )
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.reply({ embeds: [noFundsEmbed] });
  }

  const currentBank = userData[userId].bankBalance || 0;
  const bankCapacity = await calculateBankCapacity(userId);
  const availableSpace = bankCapacity - currentBank;

  if (availableSpace <= 0) {
    const fullEmbed = new EmbedBuilder()
      .setTitle('Bank Full')
      .setDescription('Your bank is at capacity. Purchase a Bank Expansion Ticket from `/store` to make room.')
      .addFields(
        { name: 'Cash on Hand', value: `$${cash.toLocaleString()}`, inline: true },
        { name: 'Bank Balance', value: `$${currentBank.toLocaleString()}`, inline: true },
        { name: 'Bank Capacity', value: `$${bankCapacity.toLocaleString()}`, inline: true }
      )
      .setColor(0xFF9F43)
      .setTimestamp();

    return await interaction.reply({ embeds: [fullEmbed] });
  }

  const amount = Math.min(cash, availableSpace);
  const partialDeposit = amount < cash;

  userData[userId].cash -= amount;
  userData[userId].bankBalance = currentBank + amount;
  await saveUserData();

  const expansions = userData[userId].bankExpansions || 0;
  const newBank = userData[userId].bankBalance;
  const successEmbed = new EmbedBuilder()
    .setTitle('Bank Deposit Completed')
    .setDescription(
      partialDeposit
        ? `Your bank could only hold $${amount.toLocaleString()} of your cash. The remainder stays on hand.`
        : `All $${amount.toLocaleString()} of your cash has been deposited.`
    )
    .addFields(
      { name: 'Deposited', value: `$${amount.toLocaleString()}`, inline: true },
      { name: 'Remaining Cash', value: `$${userData[userId].cash.toLocaleString()}`, inline: true },
      { name: 'New Bank Balance', value: `$${newBank.toLocaleString()}`, inline: true },
      { name: 'Bank Capacity Used', value: `${((newBank / bankCapacity) * 100).toFixed(1)}%`, inline: true },
      { name: 'Available Space', value: `$${(bankCapacity - newBank).toLocaleString()}`, inline: true },
      { name: 'Expansions Owned', value: `${expansions}`, inline: true }
    )
    .setColor(0x00FF7F)
    .setFooter({ text: 'Your banked money is safe from theft attempts' })
    .setTimestamp();

  await interaction.reply({ embeds: [successEmbed] });
}

async function handleWithdrawCommand(interaction, userId) {
  const amount = interaction.options.getInteger('amount');
  const currentBank = userData[userId].bankBalance || 0;

  // Check sufficient bank funds
  if (amount > currentBank) {
    const insufficientEmbed = new EmbedBuilder()
      .setTitle('Insufficient Bank Funds')
      .setDescription('You do not have enough money in your bank account for this withdrawal.')
      .addFields(
        { name: 'Available Bank Funds', value: `$${currentBank.toLocaleString()}`, inline: true },
        { name: 'Attempted Withdrawal', value: `$${amount.toLocaleString()}`, inline: true },
        { name: 'Shortfall', value: `$${(amount - currentBank).toLocaleString()}`, inline: true }
      )
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.reply({ embeds: [insufficientEmbed] });
  }

  // Process withdrawal
  userData[userId].bankBalance = currentBank - amount;
  userData[userId].cash += amount;
  await saveUserData();

  const finalCapacity = await calculateBankCapacity(userId);
  const expansions = userData[userId].bankExpansions || 0;
  const successEmbed = new EmbedBuilder()
    .setTitle('Bank Withdrawal Completed')
    .setDescription(`Successfully withdrew $${amount.toLocaleString()} from your bank account.`)
    .addFields(
      { name: 'Transaction Amount', value: `$${amount.toLocaleString()}`, inline: true },
      { name: 'New Cash Balance', value: `$${userData[userId].cash.toLocaleString()}`, inline: true },
      { name: 'Remaining Bank Funds', value: `$${userData[userId].bankBalance.toLocaleString()}`, inline: true },
      { name: 'Bank Capacity Used', value: `${((userData[userId].bankBalance / finalCapacity) * 100).toFixed(1)}%`, inline: true },
      { name: 'Available Space', value: `$${(finalCapacity - userData[userId].bankBalance).toLocaleString()}`, inline: true },
      { name: 'Expansions Owned', value: `${expansions}`, inline: true }
    )
    .setColor(0x339AF0)
    .setFooter({ text: 'Warning: Cash on hand can be stolen by other players' })
    .setTimestamp();

  await interaction.reply({ embeds: [successEmbed] });
}

async function handleStealCommand(interaction, userId) {
  const STEAL_COOLDOWN = 30 * 60 * 1000; // 30 minutes
  const now = Date.now();

  // Check cooldown
  if (cooldowns.steal[userId] && (now - cooldowns.steal[userId]) < STEAL_COOLDOWN) {
    const timeLeft = STEAL_COOLDOWN - (now - cooldowns.steal[userId]);
    const minutes = Math.floor(timeLeft / (60 * 1000));
    const seconds = Math.floor((timeLeft % (60 * 1000)) / 1000);

    const cooldownEmbed = new EmbedBuilder()
      .setTitle('Steal Cooldown Active')
      .setDescription('You must wait before attempting another theft.')
      .addFields(
        { name: 'Time Remaining', value: `${minutes}m ${seconds}s`, inline: true },
        { name: 'Cooldown Duration', value: '30 minutes', inline: true }
      )
      .setColor(0xFF9F43)
      .setTimestamp();

    return await interaction.reply({ embeds: [cooldownEmbed] });
  }

  const target = interaction.options.getUser('target');
  const amount = interaction.options.getInteger('amount');

  if (target.id === userId) {
    const selfEmbed = new EmbedBuilder()
      .setTitle('Invalid Target')
      .setDescription('You cannot steal from yourself.')
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.reply({ embeds: [selfEmbed] });
  }

  const targetId = target.id;
  if (!userData[targetId]) userData[targetId] = { cash: 0, artefacts: [], bankBalance: 0 };

  const availableCash = userData[targetId].cash;

  if (amount > availableCash) {
    const unavailableEmbed = new EmbedBuilder()
      .setTitle('Insufficient Target Funds')
      .setDescription(`${target.username} does not have enough cash available for this theft attempt.`)
      .addFields(
        { name: 'Target Available Cash', value: `$${availableCash.toLocaleString()}`, inline: true },
        { name: 'Attempted Theft', value: `$${amount.toLocaleString()}`, inline: true },
        { name: 'Protected Funds', value: 'Bank money cannot be stolen', inline: false }
      )
      .setColor(0xFF9F43)
      .setTimestamp();

    return await interaction.reply({ embeds: [unavailableEmbed] });
  }

  // Calculate success rate
  let successRate = Math.max(10, 80 - (amount / 20));
  successRate = Math.min(80, successRate);

  const randomRoll = Math.random() * 100;
  const isSuccess = randomRoll <= successRate;

  if (isSuccess) {
    // Process successful theft
    userData[targetId].cash -= amount;
    userData[userId].cash += amount;
    cooldowns.steal[userId] = now;
    await saveUserData();
    await saveCooldowns();

    const successEmbed = new EmbedBuilder()
      .setTitle('Theft Successful')
      .setDescription(`You successfully stole $${amount.toLocaleString()} from ${target.username}.`)
      .addFields(
        { name: 'Stolen Amount', value: `$${amount.toLocaleString()}`, inline: true },
        { name: 'Success Probability', value: `${successRate.toFixed(1)}%`, inline: true },
        { name: 'Your Roll', value: `${randomRoll.toFixed(1)}%`, inline: true },
        { name: 'Your New Cash Total', value: `$${userData[userId].cash.toLocaleString()}`, inline: true },
        { name: 'Risk vs Reward', value: 'Higher amounts = Lower success rate', inline: false }
      )
      .setColor(0x51CF66)
      .setFooter({ text: 'The victim has been notified of this theft' })
      .setTimestamp();

    await interaction.reply({ embeds: [successEmbed] });

    // Notify victim
    const victimEmbed = new EmbedBuilder()
      .setTitle('Theft Alert')
      .setDescription(`${interaction.user.username} has stolen $${amount.toLocaleString()} from your cash reserves.`)
      .addFields(
        { name: 'Amount Stolen', value: `$${amount.toLocaleString()}`, inline: true },
        { name: 'Remaining Cash', value: `$${userData[targetId].cash.toLocaleString()}`, inline: true },
        { name: 'Bank Balance', value: `$${userData[targetId].bankBalance || 0}`, inline: true },
        { name: 'Protection Tip', value: 'Keep funds in your bank account to prevent future thefts', inline: false }
      )
      .setColor(0xFF6B6B)
      .setTimestamp();

    try {
      await target.send({ embeds: [victimEmbed] });
    } catch (error) {
      // User has DMs disabled
    }

  } else {
    // Theft failed - still set cooldown
    cooldowns.steal[userId] = now;
    await saveCooldowns();

    const failureEmbed = new EmbedBuilder()
      .setTitle('Theft Failed')
      .setDescription(`Your theft attempt on ${target.username} was unsuccessful.`)
      .addFields(
        { name: 'Attempted Amount', value: `$${amount.toLocaleString()}`, inline: true },
        { name: 'Success Probability', value: `${successRate.toFixed(1)}%`, inline: true },
        { name: 'Your Roll', value: `${randomRoll.toFixed(1)}%`, inline: true },
        { name: 'Outcome', value: 'Mission Failed', inline: true },
        { name: 'Strategy Tip', value: 'Smaller amounts have higher success rates', inline: false }
      )
      .setColor(0xFF6B6B)
      .setTimestamp();

    await interaction.reply({ embeds: [failureEmbed] });
  }
}

// Game command handlers
async function handleScavengeCommand(interaction, userId) {
  await interaction.deferReply();
  const now = Date.now();
  const SCAVENGE_COOLDOWN = 2 * 60 * 60 * 1000; // 2 hours

  if (cooldowns.scavenge[userId] && (now - cooldowns.scavenge[userId]) < SCAVENGE_COOLDOWN) {
    const timeLeft = SCAVENGE_COOLDOWN - (now - cooldowns.scavenge[userId]);
    const hours = Math.floor(timeLeft / (60 * 60 * 1000));
    const minutes = Math.floor((timeLeft % (60 * 60 * 1000)) / (60 * 1000));

    const cooldownEmbed = new EmbedBuilder()
      .setTitle('Scavenge Cooldown Active')
      .setDescription('You must wait before scavenging again.')
      .addFields(
        { name: 'Time Remaining', value: `${hours}h ${minutes}m`, inline: true },
        { name: 'Cooldown Duration', value: '2 hours', inline: true }
      )
      .setColor(0xFF9F43)
      .setTimestamp();

    return await interaction.editReply({ embeds: [cooldownEmbed] });
  }

  // Check for active events before scavenging
  await checkAndHandleEvents();

  // Get modified chances based on current events
  const currentRarities = await getModifiedArtefactChances();
  const totalChance = currentRarities.reduce((sum, rarity) => sum + rarity.chance, 0);

  // Random artefact generation with event modifications
  const random = Math.random() * totalChance;
  let selectedRarity = null;
  let cumulative = 0;

  for (const rarity of currentRarities) {
    cumulative += rarity.chance;
    if (random <= cumulative) {
      selectedRarity = rarity;
      break;
    }
  }

  if (!selectedRarity || selectedRarity.items.length === 0) {
    // Fallback to common rarity if something goes wrong
    selectedRarity = rarities[0];
  }

  const artefact = selectedRarity.items[Math.floor(Math.random() * selectedRarity.items.length)];

  // 0.5% chance for shiny version
  const isShiny = Math.random() < 0.005;
  const finalArtefactName = isShiny ? `✨ SHINY ${artefact} ✨` : artefact;

  userData[userId].artefacts.push(finalArtefactName);
  if (!userData[userId].discoveredArtefacts) userData[userId].discoveredArtefacts = [];
  if (!userData[userId].discoveredArtefacts.includes(artefact)) {
    userData[userId].discoveredArtefacts.push(artefact);
  }
  cooldowns.scavenge[userId] = now;

  await saveUserData();
  await saveCooldowns();

  // Check if this find was affected by events
  const eventData = await getEventSystem();
  const event = eventData ? eventData.currentEvent : null;
  let eventText = '';
  let scavengeColor = isShiny ? 0xFFFFFF : selectedRarity.color;

  if (isShiny) {
    eventText = '✨ **AMAZING LUCK!** You discovered a super rare shiny version! ✨';
  } else if (event && artefact === event.positiveArtefact) {
    eventText = `⚡ **EVENT BONUS:** Found in the expanded ${event.positiveArtefact} mine!`;
    scavengeColor = 0xFFD700; // Gold color for event bonus
  }

  const scavengeEmbed = new EmbedBuilder()
    .setTitle(isShiny ? '✨ SHINY ARTEFACT DISCOVERED! ✨' : (event && artefact === event.positiveArtefact ? '🌟 Enhanced Scavenge Complete!' : 'Scavenge Complete'))
    .setDescription(isShiny ? 
      `Holy cow! You found a **SHINY ${artefact}**! This is incredibly rare and worth 20 times more!` :
      (event && artefact === event.positiveArtefact ? 
      'You discovered a valuable artefact in the expanded mine sector!' : 
      'You discovered a valuable artefact during your search!'))
    .addFields(
      { name: 'Artefact Found', value: `${finalArtefactName}`, inline: true },
      { name: 'Rarity', value: `${selectedRarity.name}`, inline: true },
      { name: 'Tier', value: `T${getArtefactTier(artefact)}`, inline: true },
      { name: 'Estimated Value', value: `$${(isShiny ? calcArtefactSellValue(finalArtefactName, selectedRarity) * 20 : calcArtefactSellValue(finalArtefactName, selectedRarity)).toLocaleString()}`, inline: true },
      { name: 'Next Scavenge', value: 'Available in 2 hours', inline: false }
    )
    .setColor(scavengeColor)
    .setTimestamp();

  if (eventText) {
    scavengeEmbed.addFields({ name: 'Mining Event', value: eventText, inline: false });
  }

  await interaction.editReply({ embeds: [scavengeEmbed] });

  // 20% chance to show server invite
  if (Math.random() < 0.20) {
    const inviteEmbed = new EmbedBuilder()
      .setTitle('✨ Join the Fortune Bot Community! ✨')
      .setDescription('We really appreciate your support! It would be even better if you joined our official server. Come hang out, get updates, and meet other players!')
      .setColor(0x5865F2)
      .setFooter({ text: 'Thank you for playing Fortune Bot!' })
      .setThumbnail(client.user.displayAvatarURL())
      .setTimestamp();

    await interaction.followUp({ content: 'https://discord.gg/NZtnJbj4QA', embeds: [inviteEmbed], ephemeral: false });
  }
}

async function handleLaborCommand(interaction, userId) {
  await interaction.deferReply();
  const now = Date.now();
  const LABOR_COOLDOWN = 40 * 60 * 1000; // 40 minutes

  if (cooldowns.labor[userId] && (now - cooldowns.labor[userId]) < LABOR_COOLDOWN) {
    const timeLeft = LABOR_COOLDOWN - (now - cooldowns.labor[userId]);
    const minutes = Math.floor(timeLeft / (60 * 1000));

    const cooldownEmbed = new EmbedBuilder()
      .setTitle('Labor Cooldown Active')
      .setDescription('You must rest before working again.')
      .addFields(
        { name: 'Time Remaining', value: `${minutes} minutes`, inline: true },
        { name: 'Cooldown Duration', value: '40 minutes', inline: true }
      )
      .setColor(0xFF9F43)
      .setTimestamp();

    return await interaction.editReply({ embeds: [cooldownEmbed] });
  }

  const earnings = Math.floor(Math.random() * 500) + 100; // $100-600
  userData[userId].cash += earnings;
  cooldowns.labor[userId] = now;

  await saveUserData();
  await saveCooldowns();

  const laborEmbed = new EmbedBuilder()
    .setTitle('Work Complete')
    .setDescription('You completed a day of honest work.')
    .addFields(
      { name: 'Earnings', value: `$${earnings.toLocaleString()}`, inline: true },
      { name: 'New Cash Total', value: `$${userData[userId].cash.toLocaleString()}`, inline: true },
      { name: 'Next Work', value: 'Available in 40 minutes', inline: false }
    )
    .setColor(0x51CF66)
    .setTimestamp();

  await interaction.editReply({ embeds: [laborEmbed] });

  // 20% chance to show server invite
  if (Math.random() < 0.20) {
    const inviteEmbed = new EmbedBuilder()
      .setTitle('✨ Join the Fortune Bot Community! ✨')
      .setDescription('We really appreciate your support! It would be even better if you joined our official server. Come hang out, get updates, and meet other players!')
      .setColor(0x5865F2)
      .setFooter({ text: 'Thank you for playing Fortune Bot!' })
      .setThumbnail(client.user.displayAvatarURL())
      .setTimestamp();

    await interaction.followUp({ content: 'https://discord.gg/NZtnJbj4QA', embeds: [inviteEmbed], ephemeral: false });
  }
}

async function handleInventoryCommand(interaction, userId) {
  await interaction.deferReply();
  const user = await getUser(userId);
  const userXpData = await getXpData(userId);
  const bankCapacity = await calculateBankCapacity(userId);

  const totalValue = user.artefacts.reduce((sum, artefactName) => {
    const isShiny = artefactName.startsWith('✨ SHINY ') && artefactName.endsWith(' ✨');
    const rarity = getRarityByArtefact(artefactName);
    const tierSell = calcArtefactSellValue(artefactName, rarity);
    return sum + (isShiny ? tierSell * 20 : tierSell);
  }, 0);

  const artefactCounts = user.artefacts.reduce((counts, artefact) => {
    counts[artefact] = (counts[artefact] || 0) + 1;
    return counts;
  }, {});

  const artefactLines = Object.keys(artefactCounts).length ?
    Object.entries(artefactCounts).map(([artefactName, count]) => {
      const rarity = getRarityByArtefact(artefactName);
      const tier = getArtefactTier(artefactName);
      const tierSell = calcArtefactSellValue(artefactName, rarity);
      const isShiny = artefactName.startsWith('✨ SHINY ') && artefactName.endsWith(' ✨');
      const sellDisplay = isShiny ? tierSell * 20 : tierSell;
      const countSuffix = count > 1 ? ` [${count}]` : '';
      return `${artefactName} (${rarity ? rarity.name : 'Unknown'} T${tier} — ${sellDisplay.toLocaleString()})${countSuffix}`;
    }) : ['No artefacts'];

  const artefactChunks = [];
  let currentChunk = '';
  for (const line of artefactLines) {
    const addition = currentChunk ? '\n' + line : line;
    if (currentChunk.length + addition.length > 1024) {
      artefactChunks.push(currentChunk);
      currentChunk = line;
    } else {
      currentChunk += addition;
    }
  }
  if (currentChunk) artefactChunks.push(currentChunk);

  const artefactFields = artefactChunks.map((chunk, i) => ({
    name: i === 0 ? 'Artefact Collection' : '\u200b',
    value: chunk,
    inline: false
  }));

  // Count purchased items
  const itemsCount = {};
  (user.items || []).forEach(item => {
    itemsCount[item] = (itemsCount[item] || 0) + 1;
  });

  const itemsList = (Object.entries(itemsCount)
    .map(([name, count]) => `${name}${count > 1 ? ` [${count}]` : ''}`)
    .join(', ') || 'No items').substring(0, 1024);

  const inventoryEmbed = new EmbedBuilder()
    .setTitle('Your Inventory')
    .setDescription('Current financial status and artefact collection')
    .addFields(
      { name: 'Cash on Hand', value: `${user.cash.toLocaleString()}`, inline: true },
      { name: 'Bank Balance', value: `${(user.bankBalance || 0).toLocaleString()}`, inline: true },
      { name: 'Total Wealth', value: `${(user.cash + (user.bankBalance || 0)).toLocaleString()}`, inline: true },
      { name: 'Experience Points', value: `${userXpData.xp.toLocaleString()} XP`, inline: true },
      { name: 'XP Cash Value', value: `${(userXpData.xp * 2).toLocaleString()}`, inline: true },
      { name: 'Messages Sent', value: `${userXpData.messageCount.toLocaleString()}`, inline: true },
      { name: 'Artefacts Owned', value: user.artefacts.length.toString(), inline: true },
      { name: 'Collection Value', value: `${totalValue.toLocaleString()}`, inline: true },
      { name: 'Bank Capacity', value: `${(((user.bankBalance || 0) / bankCapacity) * 100).toFixed(1)}%`, inline: true },
      ...artefactFields,
      { name: 'Purchased Items', value: itemsList, inline: false }
    )
    .setColor(0x339AF0)
    .setFooter({ text: 'Use /convert to turn XP into cash (1 XP = $2)' })
    .setTimestamp();

  await interaction.editReply({ embeds: [inventoryEmbed] });
}


async function handleTradeCommand(interaction, userId) {
  const targetUser = interaction.options.getUser('user');

  if (targetUser.id === userId) {
    const selfEmbed = new EmbedBuilder()
      .setTitle('Invalid Trade Target')
      .setDescription('You cannot trade with yourself.')
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.reply({ embeds: [selfEmbed] });
  }

  if (targetUser.bot) {
    const botEmbed = new EmbedBuilder()
      .setTitle('Invalid Trade Target')
      .setDescription('You cannot trade with bots.')
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.reply({ embeds: [botEmbed] });
  }

  // Check if user is already in a trade
  const existingTrade = Object.values(global.activeTrades).find(trade => 
    trade.initiator === userId || trade.recipient === targetUser.id ||
    trade.initiator === targetUser.id || trade.recipient === userId
  );

  if (existingTrade) {
    const busyEmbed = new EmbedBuilder()
      .setTitle('Trade Already Active')
      .setDescription('You or the target user is already in an active trade.')
      .setColor(0xFF9F43)
      .setTimestamp();

    return await interaction.reply({ embeds: [busyEmbed] });
  }

  // Initialize target user data if needed
  if (!userData[targetUser.id]) userData[targetUser.id] = { cash: 0, artefacts: [], bankBalance: 0 };

  // Create trade request for recipient to accept/decline
  const acceptButton = new ButtonBuilder()
    .setCustomId(`trade_accept_${userId}`)
    .setLabel('Accept Trade')
    .setStyle(ButtonStyle.Success);

  const declineButton = new ButtonBuilder()
    .setCustomId(`trade_decline_${userId}`)
    .setLabel('Decline Trade')
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder().addComponents(acceptButton, declineButton);

  const tradeRequestEmbed = new EmbedBuilder()
    .setTitle('Trade Request')
    .setDescription(`**${interaction.user.displayName}** wants to trade with you.`)
    .addFields(
      { name: 'Initiator', value: `<@${userId}>`, inline: true },
      { name: 'Recipient', value: `<@${targetUser.id}>`, inline: true },
      { name: 'Status', value: 'Waiting for response...', inline: false },
      { name: 'Action Required', value: 'Choose **Accept** or **Decline** below.', inline: false }
    )
    .setColor(0x5865F2)
    .setFooter({ text: 'This request will expire after 2 minutes' })
    .setTimestamp();

  await interaction.reply({ 
    content: `<@${targetUser.id}>`, 
    embeds: [tradeRequestEmbed], 
    components: [row] 
  });

  // Set timeout for trade request
  setTimeout(() => {
    if (global.activeTrades[`${userId}_${targetUser.id}`]) {
      delete global.activeTrades[`${userId}_${targetUser.id}`];
    }
  }, 120000); // 2 minutes
}

async function handleLeaderboardCommand(interaction) {
  // Query all users directly from MongoDB so rankings persist across bot restarts
  const allDocs = await usersCollection.find({}, { projection: { cash: 1, bankBalance: 1 } }).toArray();

  // Build entries, using the live in-memory cache where available so any
  // recent changes that haven't been flushed yet are reflected accurately
  const entries = allDocs.map(doc => {
    const live = userData[doc._id];
    const cash = live !== undefined ? live.cash : (doc.cash || 0);
    const bank = live !== undefined ? (live.bankBalance || 0) : (doc.bankBalance || 0);
    return { id: doc._id, total: cash + bank };
  });

  entries.sort((a, b) => b.total - a.total);
  const top10 = entries.filter(e => e.total > 0).slice(0, 10);

  if (!top10.length) {
    const emptyEmbed = new EmbedBuilder()
      .setTitle('Leaderboard')
      .setDescription('No players have earned money yet.')
      .setColor(0x339AF0)
      .setTimestamp();

    return await interaction.reply({ embeds: [emptyEmbed] });
  }

  const medals = ['1st', '2nd', '3rd'];
  const leaderboardEmbed = new EmbedBuilder()
    .setTitle('Top Fortune Holders')
    .setDescription(top10.map((entry, i) => {
      const place = medals[i] || `${i + 1}th`;
      return `**${place}** <@${entry.id}> — $${entry.total.toLocaleString()}`;
    }).join('\n'))
    .setColor(0xFFD700)
    .setFooter({ text: 'Rankings based on total wealth (cash + bank balance)' })
    .setTimestamp();

  await interaction.reply({ embeds: [leaderboardEmbed] });
}

async function handleStoreCommand(interaction) {
  // Interaction already deferred in main handler to prevent timeout

  // Use guildId directly (always available) instead of guild object
  const guildId = interaction.guildId;

  // Additional safety check - commands should only work in servers
  if (!guildId) {
    const dmEmbed = new EmbedBuilder()
      .setTitle('Server Required')
      .setDescription('This command requires server context.')
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.editReply({ embeds: [dmEmbed] });
  }

  try {
    const userId = interaction.user.id;

    // Run all database queries in parallel for speed
    const [user, globalItems, guildItemsDoc] = await Promise.all([
      getUser(userId),
      getGlobalItems(),
      guildItemsCollection.findOne({ _id: guildId })
    ]);

    const guildItems = guildItemsDoc ? guildItemsDoc.items : {};
    const embeds = [];

  // Global Store Embed
  if (Object.keys(globalItems).length > 0) {
    let globalItemsList = '';

    for (const [name, item] of Object.entries(globalItems)) {
      if (item.type === 'bank_expansion') {
        // Calculate both price and capacity in parallel
        const [currentPrice, currentCapacity] = await Promise.all([
          calculateExpansionPrice(userId),
          calculateBankCapacity(userId)
        ]);
        const currentExpansions = userData[userId]?.bankExpansions || 0;
        const nextCapacity = Math.floor(50000 * Math.pow(1.25, currentExpansions + 1));

        globalItemsList += `**${name}**\n`;
        globalItemsList += `Current Price: $${currentPrice.toLocaleString()}\n`;
        globalItemsList += `${item.description}\n`;
        globalItemsList += `Your Bank: $${currentCapacity.toLocaleString()} capacity (${currentExpansions} expansions)\n`;
        globalItemsList += `Next Expansion: $${nextCapacity.toLocaleString()} capacity\n\n`;
      }
    }

    const globalEmbed = new EmbedBuilder()
      .setTitle('Global Store')
      .setDescription('**Cross-server items available to all players**')
      .addFields(
        { name: 'Available Items', value: globalItemsList || 'No items available', inline: false },
        { name: 'How to Purchase', value: 'Use `/buy <item_name>` to purchase global items', inline: false }
      )
      .setColor(0xFFD700)
      .setFooter({ text: 'Global items • Available across all servers' })
      .setTimestamp();

    embeds.push(globalEmbed);
  }

  // Server Store Embed
  if (Object.keys(guildItems).length > 0) {
    const serverItemsList = Object.entries(guildItems)
      .map(([name, data]) => `**${name}**\nPrice: $${data.price.toLocaleString()}\n${data.description}`)
      .join('\n\n');

    const serverEmbed = new EmbedBuilder()
      .setTitle('Server Store')
      .setDescription(`**Server-specific items for this server**`)
      .addFields(
        { name: 'Available Items', value: serverItemsList, inline: false },
        { name: 'How to Purchase', value: 'Use `/buy <item_name>` to purchase server items', inline: false }
      )
      .setColor(0x9932CC)
      .setFooter({ text: 'Server items • Custom additions by administrators' })
      .setTimestamp();

    embeds.push(serverEmbed);
  } else {
    const emptyServerEmbed = new EmbedBuilder()
      .setTitle('Server Store')
      .setDescription('This server currently has no custom items available for purchase.')
      .addFields(
        { name: 'Get Started', value: 'Ask an administrator to add items using `/add-item`', inline: false },
        { name: 'Available Commands', value: '`/add-item` - Add new items (Admin only)\n`/view-items` - Manage items (Admin only)', inline: false }
      )
      .setColor(0x6C7B7F)
      .setTimestamp();

    embeds.push(emptyServerEmbed);
  }

    await interaction.editReply({ embeds: embeds });
  } catch (error) {
    console.error('❌ Store command error:', error);

    const errorEmbed = new EmbedBuilder()
      .setTitle('Store Error')
      .setDescription('An error occurred while loading the store. Please try again.')
      .setColor(0xFF6B6B)
      .setTimestamp();

    await interaction.editReply({ embeds: [errorEmbed] });
  }
}

async function handleBuyCommand(interaction, userId) {
  try {
    const itemName = interaction.options.getString('item').trim();
    const guildId = interaction.guildId;
    const user = await getUser(userId);

    const [globalItems, guildItemsDoc] = await Promise.all([
      getGlobalItems(),
      guildId ? guildItemsCollection.findOne({ _id: guildId }) : null
    ]);

    const guildItems = guildItemsDoc ? guildItemsDoc.items : {};

    let item = null;
    let itemType = null;
    let itemPrice = 0;

    if (globalItems[itemName]) {
      item = globalItems[itemName];
      itemType = 'global';

      if (item.type === 'bank_expansion') {
        itemPrice = await calculateExpansionPrice(userId);
      } else {
        itemPrice = item.basePrice || item.price || 0;
      }
    } else if (guildItems[itemName]) {
      item = guildItems[itemName];
      itemType = 'server';
      itemPrice = item.price;
    }

    if (!item) {
      const availableItems = [...Object.keys(globalItems), ...Object.keys(guildItems)];
      const notFoundEmbed = new EmbedBuilder()
        .setTitle('Item Not Found')
        .setDescription(`"${itemName}" is not available in any store.`)
        .addFields({
          name: 'Available Items',
          value: availableItems.length > 0 ? availableItems.join(', ') : 'No items available',
          inline: false
        })
        .setColor(0xFF6B6B)
        .setTimestamp();

      return await interaction.editReply({ embeds: [notFoundEmbed] });
    }

    if (user.cash < itemPrice) {
      const insufficientEmbed = new EmbedBuilder()
        .setTitle('Insufficient Funds')
        .setDescription(`You don't have enough cash to purchase ${itemName}.`)
        .addFields(
          { name: 'Required Cash', value: `$${itemPrice.toLocaleString()}`, inline: true },
          { name: 'Your Cash', value: `$${user.cash.toLocaleString()}`, inline: true },
          { name: 'Shortfall', value: `$${(itemPrice - user.cash).toLocaleString()}`, inline: true }
        )
        .setColor(0xFF6B6B)
        .setTimestamp();

      return await interaction.editReply({ embeds: [insufficientEmbed] });
    }

    if (itemType === 'global' && item.type === 'bank_expansion') {
      const result = await purchaseBankExpansion(userId);

      if (!result.success) {
        const errorEmbed = new EmbedBuilder()
          .setTitle('Purchase Failed')
          .setDescription('An error occurred while processing your purchase.')
          .setColor(0xFF6B6B)
          .setTimestamp();

        return await interaction.editReply({ embeds: [errorEmbed] });
      }

      const successEmbed = new EmbedBuilder()
        .setTitle('Bank Expansion Purchased')
        .setDescription(`Successfully purchased ${itemName} for $${result.price.toLocaleString()}!`)
        .addFields(
          { name: 'Bank Capacity Increased', value: `$${result.newCapacity.toLocaleString()}`, inline: true },
          { name: 'Total Expansions', value: `${result.newExpansions}`, inline: true },
          { name: 'Remaining Cash', value: `$${user.cash.toLocaleString()}`, inline: true },
          { name: 'Next Expansion Price', value: `$${(await calculateExpansionPrice(userId)).toLocaleString()}`, inline: true },
          { name: 'Capacity Increase', value: '+25%', inline: true },
          { name: 'Investment Status', value: 'Permanent Upgrade', inline: true }
        )
        .setColor(0x00FF7F)
        .setFooter({ text: 'Bank expansion permanently increases your storage capacity' })
        .setTimestamp();

      await interaction.editReply({ embeds: [successEmbed] });
    } else {
      user.cash -= itemPrice;

      if (!user.items) user.items = [];
      user.items.push(itemName);

      await saveUser(userId);

      const successEmbed = new EmbedBuilder()
        .setTitle('Purchase Successful')
        .setDescription(`Successfully purchased **${itemName}** for $${itemPrice.toLocaleString()}!`)
        .addFields(
          { name: 'Item', value: itemName, inline: true },
          { name: 'Price Paid', value: `$${itemPrice.toLocaleString()}`, inline: true },
          { name: 'Remaining Cash', value: `$${user.cash.toLocaleString()}`, inline: true },
          { name: 'Description', value: item.description || 'No description', inline: false },
          { name: 'Added to Inventory', value: 'View your items with `/inventory`', inline: false }
        )
        .setColor(0x00FF7F)
        .setTimestamp();

      await interaction.editReply({ embeds: [successEmbed] });
    }
  } catch (error) {
    console.error('❌ Buy command error:', error);

    const errorEmbed = new EmbedBuilder()
      .setTitle('Purchase Error')
      .setDescription('An error occurred while processing your purchase. Please try again.')
      .setColor(0xFF6B6B)
      .setTimestamp();

    await interaction.editReply({ embeds: [errorEmbed] });
  }
}

// === MASS SELL HELPERS ===

function getMassSellValue(name) {
  const isShiny = name.startsWith('✨ SHINY ') && name.endsWith(' ✨');
  const rarity = getRarityByArtefact(name);
  const tier = getArtefactTier(name);
  const tierSell = calcArtefactSellValue(name, rarity);
  return { isShiny, rarity, tier, finalValue: isShiny ? tierSell * 20 : tierSell };
}

function buildMassSellEmbed(session, userArtefacts) {
  const queueText = session.queue.length
    ? session.queue.map(e => {
        const { rarity, tier, finalValue } = getMassSellValue(e.name);
        return `${e.name} x${e.amount} — ${rarity ? rarity.name : 'Unknown'} T${tier} ($${(finalValue * e.amount).toLocaleString()} total)`;
      }).join('\n')
    : 'Nothing queued yet — select an artefact and add it below.';

  const totalValue = session.queue.reduce((sum, e) => {
    const { finalValue } = getMassSellValue(e.name);
    return sum + finalValue * e.amount;
  }, 0);

  const totalItems = session.queue.reduce((s, e) => s + e.amount, 0);

  return new EmbedBuilder()
    .setTitle('Mass Sell Artefacts')
    .setDescription('Select an artefact from the dropdown, then queue it for sale. Confirm when your list is ready.')
    .addFields(
      { name: 'Currently Selected', value: session.selectedArtefact || 'None — pick from the dropdown below', inline: false },
      { name: `Queue (${totalItems} artefact${totalItems !== 1 ? 's' : ''})`, value: queueText, inline: false },
      { name: 'Total Sell Value', value: `$${totalValue.toLocaleString()}`, inline: true },
      { name: 'Artefacts in Inventory', value: userArtefacts.length.toString(), inline: true }
    )
    .setColor(session.queue.length > 0 ? 0x51CF66 : 0x339AF0)
    .setFooter({ text: 'Session expires in 5 minutes' })
    .setTimestamp();
}

function buildMassSellComponents(sessionId, session, userArtefacts) {
  // Count total owned per unique artefact name
  const ownedCounts = {};
  userArtefacts.forEach(name => { ownedCounts[name] = (ownedCounts[name] || 0) + 1; });

  // Subtract already queued amounts to get available counts
  const availableCounts = { ...ownedCounts };
  session.queue.forEach(e => {
    if (availableCounts[e.name]) availableCounts[e.name] -= e.amount;
  });

  const availableEntries = Object.entries(availableCounts).filter(([, c]) => c > 0);
  const rows = [];

  if (availableEntries.length > 0) {
    const selectOptions = availableEntries.slice(0, 25).map(([name, count]) => {
      const { rarity, tier, finalValue } = getMassSellValue(name);
      return {
        label: name.length > 100 ? name.slice(0, 97) + '...' : name,
        description: `${rarity ? rarity.name : 'Unknown'} T${tier} — $${finalValue.toLocaleString()} each (${count} available)`,
        value: name,
        default: session.selectedArtefact === name
      };
    });

    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`ms_select_${sessionId}`)
        .setPlaceholder('Select an artefact to queue for sale')
        .addOptions(selectOptions)
    ));
  }

  const hasSelection = !!session.selectedArtefact && (availableCounts[session.selectedArtefact] || 0) > 0;
  const hasQueue = session.queue.length > 0;
  const totalItems = session.queue.reduce((s, e) => s + e.amount, 0);

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ms_add_one_${sessionId}`)
      .setLabel('Add x1')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!hasSelection),
    new ButtonBuilder()
      .setCustomId(`ms_add_custom_${sessionId}`)
      .setLabel('Add Custom Amount')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasSelection),
    new ButtonBuilder()
      .setCustomId(`ms_clear_${sessionId}`)
      .setLabel('Clear Queue')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasQueue),
    new ButtonBuilder()
      .setCustomId(`ms_confirm_${sessionId}`)
      .setLabel(`Confirm Sale (${totalItems})`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(!hasQueue),
    new ButtonBuilder()
      .setCustomId(`ms_cancel_${sessionId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger)
  ));

  return rows;
}

// New command handlers
async function handleMassSellCommand(interaction, userId) {
  const user = await getUser(userId);

  if (!user.artefacts || !user.artefacts.length) {
    return await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('No Artefacts to Sell')
        .setDescription('You need to find some artefacts first before you can sell them.')
        .setColor(0xFF6B6B)
        .setTimestamp()
      ]
    });
  }

  const sessionId = `${userId}_${Date.now()}`;
  const session = {
    userId,
    selectedArtefact: null,
    queue: [],
    message: null
  };

  global.massSellSessions[sessionId] = session;

  const reply = await interaction.reply({
    embeds: [buildMassSellEmbed(session, user.artefacts)],
    components: buildMassSellComponents(sessionId, session, user.artefacts),
    fetchReply: true
  });

  session.message = reply;

  const collector = reply.createMessageComponentCollector({
    filter: i => i.user.id === userId,
    time: 300000
  });

  collector.on('collect', async i => {
    if (i.customId === `ms_select_${sessionId}`) {
      session.selectedArtefact = i.values[0];
      await i.update({ embeds: [buildMassSellEmbed(session, user.artefacts)], components: buildMassSellComponents(sessionId, session, user.artefacts) });

    } else if (i.customId === `ms_add_one_${sessionId}`) {
      const ownedCount = user.artefacts.filter(a => a === session.selectedArtefact).length;
      const queued = session.queue.find(e => e.name === session.selectedArtefact)?.amount || 0;
      if (queued >= ownedCount) {
        return await i.reply({ content: `You have no more copies of ${session.selectedArtefact} available to queue.`, ephemeral: true });
      }
      const existing = session.queue.find(e => e.name === session.selectedArtefact);
      if (existing) {
        existing.amount++;
      } else {
        session.queue.push({ name: session.selectedArtefact, amount: 1 });
      }
      await i.update({ embeds: [buildMassSellEmbed(session, user.artefacts)], components: buildMassSellComponents(sessionId, session, user.artefacts) });

    } else if (i.customId === `ms_add_custom_${sessionId}`) {
      const modal = new ModalBuilder()
        .setCustomId(`ms_amount_modal_${sessionId}`)
        .setTitle(`Amount for ${session.selectedArtefact}`)
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('ms_amount_input')
              .setLabel(`How many ${session.selectedArtefact} to sell?`)
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Enter a number')
              .setMinLength(1)
              .setMaxLength(5)
              .setRequired(true)
          )
        );
      await i.showModal(modal);

    } else if (i.customId === `ms_clear_${sessionId}`) {
      session.queue = [];
      await i.update({ embeds: [buildMassSellEmbed(session, user.artefacts)], components: buildMassSellComponents(sessionId, session, user.artefacts) });

    } else if (i.customId === `ms_confirm_${sessionId}`) {
      let totalEarned = 0;
      const summaryLines = [];

      for (const entry of session.queue) {
        let remaining = entry.amount;
        user.artefacts = user.artefacts.filter(name => {
          if (name === entry.name && remaining > 0) { remaining--; return false; }
          return true;
        });
        const { finalValue } = getMassSellValue(entry.name);
        totalEarned += finalValue * entry.amount;
        const { rarity } = getMassSellValue(entry.name);
        summaryLines.push(`${entry.name} x${entry.amount} (${rarity ? rarity.name : 'Unknown'}) — $${(finalValue * entry.amount).toLocaleString()}`);
      }

      user.cash += totalEarned;
      await saveUser(userId);
      collector.stop('sold');
      delete global.massSellSessions[sessionId];

      const soldDisplay = summaryLines.slice(0, 20).join('\n')
        + (summaryLines.length > 20 ? `\n... and ${summaryLines.length - 20} more` : '');

      await i.update({
        embeds: [new EmbedBuilder()
          .setTitle('Sale Complete')
          .setDescription(`Successfully sold artefacts for **$${totalEarned.toLocaleString()}**!`)
          .addFields(
            { name: 'Items Sold', value: soldDisplay, inline: false },
            { name: 'Total Earned', value: `$${totalEarned.toLocaleString()}`, inline: true },
            { name: 'New Cash Balance', value: `$${user.cash.toLocaleString()}`, inline: true }
          )
          .setColor(0x51CF66)
          .setTimestamp()
        ],
        components: []
      });

    } else if (i.customId === `ms_cancel_${sessionId}`) {
      collector.stop('cancelled');
      delete global.massSellSessions[sessionId];
      await i.update({
        embeds: [new EmbedBuilder()
          .setTitle('Sale Cancelled')
          .setDescription('No artefacts were sold.')
          .setColor(0xFF6B6B)
          .setTimestamp()
        ],
        components: []
      });
    }
  });

  collector.on('end', async (collected, reason) => {
    if (reason === 'time') {
      delete global.massSellSessions[sessionId];
      try {
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setTitle('Session Expired')
            .setDescription('The mass sell session timed out. No artefacts were sold.')
            .setColor(0xFF9F43)
            .setTimestamp()
          ],
          components: []
        });
      } catch (e) {}
    }
  });
}

async function handleAddItemCommand(interaction) {
  // Use guildId directly (always available) instead of guild object
  const guildId = interaction.guildId;

  if (!guildId) {
    const dmEmbed = new EmbedBuilder()
      .setTitle('Server Required')
      .setDescription('This command requires server context.')
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.editReply({ embeds: [dmEmbed] });
  }

  // Check if user is admin
  if (interaction.user.id !== DEVELOPER_ID && !interaction.member?.permissions.has('Administrator')) {
    const noPermEmbed = new EmbedBuilder()
      .setTitle('Access Denied')
      .setDescription('Only administrators can add custom server items.')
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.editReply({ embeds: [noPermEmbed] });
  }

  const itemName = interaction.options.getString('name');
  const itemPrice = interaction.options.getInteger('price');
  const itemDescription = interaction.options.getString('description') || 'Custom server item';

  const guildItemsDoc = await guildItemsCollection.findOne({ _id: guildId });
  const guildItems = guildItemsDoc ? guildItemsDoc.items : {};

  guildItems[itemName] = {
    price: itemPrice,
    description: itemDescription,
    addedBy: interaction.user.id,
    addedAt: Date.now()
  };

  await guildItemsCollection.replaceOne(
    { _id: guildId },
    { _id: guildId, items: guildItems },
    { upsert: true }
  );

  const addEmbed = new EmbedBuilder()
    .setTitle('Item Added Successfully')
    .setDescription(`**Added "${itemName}"** to the server store.`)
    .addFields(
      { name: 'Item Name', value: `**${itemName}**`, inline: true },
      { name: 'Price', value: `**$${itemPrice.toLocaleString()}**`, inline: true },
      { name: 'Description', value: itemDescription, inline: false }
    )
    .setColor(0x00FF7F)
    .setTimestamp();

  await interaction.editReply({ embeds: [addEmbed] });
}

async function handleRemoveItemCommand(interaction) {
  // Check if user is admin
  if (interaction.user.id !== DEVELOPER_ID && !interaction.member.permissions.has('Administrator')) {
    const noPermEmbed = new EmbedBuilder()
      .setTitle('Access Denied')
      .setDescription('Only administrators can remove custom server items.')
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.reply({ embeds: [noPermEmbed] });
  }

  const itemName = interaction.options.getString('name');
  const guildId = interaction.guild.id;

  const guildItemsDoc = await guildItemsCollection.findOne({ _id: guildId });
  const guildItems = guildItemsDoc ? guildItemsDoc.items : {};

  if (!guildItems[itemName]) {
    const notFoundEmbed = new EmbedBuilder()
      .setTitle('Item Not Found')
      .setDescription(`No custom item named "${itemName}" exists in this server.`)
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.reply({ embeds: [notFoundEmbed] });
  }

  delete guildItems[itemName];
  await guildItemsCollection.replaceOne(
    { _id: guildId },
    { _id: guildId, items: guildItems },
    { upsert: true }
  );

  const removeEmbed = new EmbedBuilder()
    .setTitle('Item Removed')
    .setDescription(`Successfully removed "${itemName}" from the server store.`)
    .setColor(0x51CF66)
    .setTimestamp();

  await interaction.reply({ embeds: [removeEmbed] });
}

async function handleViewItemsCommand(interaction) {
  // Check if user is admin
  if (interaction.user.id !== DEVELOPER_ID && !interaction.member.permissions.has('Administrator')) {
    const noPermEmbed = new EmbedBuilder()
      .setTitle('Access Denied')
      .setDescription('Only administrators can view the custom items management panel.')
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.reply({ embeds: [noPermEmbed] });
  }

  const guildId = interaction.guild.id;
  const guildItemsDoc = await guildItemsCollection.findOne({ _id: guildId });
  const guildItems = guildItemsDoc ? guildItemsDoc.items : {};

  if (Object.keys(guildItems).length === 0) {
    const noItemsEmbed = new EmbedBuilder()
      .setTitle('No Custom Items')
      .setDescription('This server has no custom items yet.')
      .addFields({ name: 'Add Items', value: 'Use `/add-item` to create custom server items', inline: false })
      .setColor(0xFF9F43)
      .setTimestamp();

    return await interaction.reply({ embeds: [noItemsEmbed] });
  }

  const itemList = Object.entries(guildItems).map(([name, data]) => 
    `**${name}** - $${data.price.toLocaleString()}\n${data.description}`
  ).join('\n\n');

  const viewEmbed = new EmbedBuilder()
    .setTitle('Custom Server Items')
    .setDescription(`This server has ${Object.keys(guildItems).length} custom item(s).`)
    .addFields({ name: 'Items', value: itemList, inline: false })
    .setColor(0x339AF0)
    .setTimestamp();

  await interaction.reply({ embeds: [viewEmbed] });
}

// Component interaction handler
async function handleComponentInteraction(interaction) {
  const { customId } = interaction;

  try {

  // Handle trade accept/decline
  if (customId.startsWith('trade_accept_')) {
    const initiatorId = customId.split('_')[2];
    const recipientId = interaction.user.id;

    // Create trade session
    const tradeId = `${initiatorId}_${recipientId}`;
    global.activeTrades[tradeId] = {
      initiator: initiatorId,
      recipient: recipientId,
      initiatorOffer: { cash: 0, artefacts: [] },
      recipientOffer: { cash: 0, artefacts: [] },
      initiatorReady: false,
      recipientReady: false,
      status: 'active'
    };

    await startInteractiveTrade(interaction, initiatorId, recipientId, tradeId);

  } else if (customId.startsWith('trade_decline_')) {
    const initiatorId = customId.split('_')[2];

    const declineEmbed = new EmbedBuilder()
      .setTitle('Trade Declined')
      .setDescription(`<@${interaction.user.id}> has declined the trade request.`)
      .setColor(0xFF6B6B)
      .setTimestamp();

    await interaction.update({ embeds: [declineEmbed], components: [] });

  // === MARBLE GAME BUTTON HANDLERS ===
  } else if (customId.startsWith('marble_accept_')) {
    const gameId = customId.replace('marble_accept_', '');
    const game = global.activeMarbleGames[gameId];

    if (!game) {
      return await interaction.reply({ 
        content: '❌ **Error:** This game is no longer active!', 
        ephemeral: true 
      });
    }

    const userId = interaction.user.id;

    // Check if this user was invited
    if (!game.invited.some(p => p.id === userId)) {
      return await interaction.reply({ 
        content: '❌ **Error:** You were not invited to this game!', 
        ephemeral: true 
      });
    }

    // Check if already responded
    if (game.accepted.includes(userId) || game.declined.includes(userId)) {
      return await interaction.reply({ 
        content: '❌ **Error:** You have already responded to this invitation!', 
        ephemeral: true 
      });
    }

    // Add to accepted list
    game.accepted.push(userId);

    // Check if all players have accepted
    if (game.accepted.length === 3) {
      // All players accepted — move to betting
      await startBettingPhase(interaction, gameId);
    } else {
      // Update embed to show new acceptance
      const updatedEmbed = createInvitationEmbed(game);
      await interaction.update({ embeds: [updatedEmbed], components: [createInvitationButtons(gameId)] });
    }

  } else if (customId.startsWith('marble_decline_')) {
    const gameId = customId.replace('marble_decline_', '');
    const game = global.activeMarbleGames[gameId];

    if (!game) {
      return await interaction.reply({ 
        content: '❌ **Error:** This game is no longer active!', 
        ephemeral: true 
      });
    }

    const userId = interaction.user.id;
    const declinedUser = game.invited.find(p => p.id === userId);

    if (!declinedUser) {
      return await interaction.reply({ 
        content: '❌ **Error:** You were not invited to this game!', 
        ephemeral: true 
      });
    }

    // Game cancelled due to decline
    const declineEmbed = new EmbedBuilder()
      .setTitle('Marble Game Cancelled')
      .setDescription(`**${declinedUser.displayName}** has declined the invitation. The marble game has been cancelled.`)
      .setColor(0xFF6B6B)
      .setTimestamp();

    await interaction.update({ embeds: [declineEmbed], components: [] });

    // Clean up the game
    delete global.activeMarbleGames[gameId];

  // === MARBLE DUEL BUTTON HANDLERS ===

  } else if (customId.startsWith('duel_accept_')) {
    const gameId = customId.replace('duel_accept_', '');
    const game = global.activeDuelGames[gameId];

    if (!game) {
      return interaction.reply({ content: '❌ This duel is no longer active.', ephemeral: true });
    }
    if (interaction.user.id !== game.players[1].id) {
      return interaction.reply({ content: '❌ You were not invited to this duel.', ephemeral: true });
    }
    if (game.accepted) {
      return interaction.reply({ content: '❌ You already responded to this invitation.', ephemeral: true });
    }

    game.accepted = true;
    await startDuelBettingPhase(interaction, gameId);

  } else if (customId.startsWith('duel_decline_')) {
    const gameId = customId.replace('duel_decline_', '');
    const game = global.activeDuelGames[gameId];

    if (!game) {
      return interaction.reply({ content: '❌ This duel is no longer active.', ephemeral: true });
    }
    if (interaction.user.id !== game.players[1].id) {
      return interaction.reply({ content: '❌ You were not invited to this duel.', ephemeral: true });
    }

    delete global.activeDuelGames[gameId];

    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setTitle('Marble Duel Declined')
          .setDescription(`**${interaction.user.displayName}** has declined the challenge. Duel cancelled.`)
          .setColor(0xFF6B6B)
          .setTimestamp()
      ],
      components: []
    });

  } else if (customId.startsWith('place_duel_bet_')) {
    const gameId = customId.replace('place_duel_bet_', '');
    const game = global.activeDuelGames[gameId];
    if (!game) return;
    if (!game.players.some(p => p.id === interaction.user.id)) {
      return interaction.reply({ content: '❌ You are not part of this duel.', ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId(`duel_bet_modal_${gameId}`)
      .setTitle('Place Your Bet')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('bet_amount_input')
            .setLabel('Bet Amount (min $50)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g. 1000')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(10)
        )
      );
    await interaction.showModal(modal);

  } else if (customId.startsWith('duel_pick_')) {
    const gameId = customId.replace('duel_pick_', '');
    await handleDuelPick(interaction, gameId);

  } else if (customId.startsWith('select_number_')) {
    const gameId = customId.replace('select_number_', '');
    await handleNumberSelection(interaction, gameId);

  } else if (customId.startsWith('place_bet_')) {
    const gameId = customId.replace('place_bet_', '');
    const game = global.activeMarbleGames[gameId];
    if (!game) return;

    const userId = interaction.user.id;
    const modal = new ModalBuilder()
      .setCustomId(`bet_modal_${gameId}`)
      .setTitle('Place Your Bet')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('bet_amount_input')
            .setLabel('Bet Amount')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(`Enter your bet (e.g., 1000)`)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(10)
        )
      );

    await interaction.showModal(modal);

  } else if (customId.startsWith('trade_add_cash_')) {
    await handleTradeAddCash(interaction, customId);

  } else if (customId.startsWith('trade_add_artefact_')) {
    await handleTradeAddArtefact(interaction, customId);

  } else if (customId.startsWith('trade_remove_cash_')) {
    await handleTradeRemoveCash(interaction, customId);

  } else if (customId.startsWith('trade_remove_artefact_')) {
    await handleTradeRemoveArtefact(interaction, customId);

  } else if (customId.startsWith('trade_ready_')) {
    await handleTradeReady(interaction, customId);

  } else if (customId.startsWith('trade_cancel_')) {
    await handleTradeCancel(interaction, customId);

  } else if (customId.startsWith('trade_cash_modal_')) {
    const tradeId = customId.split('_')[3];
    const trade = global.activeTrades[tradeId];
    if (!trade) {
      return await interaction.reply({ content: '❌ Trade session not found!', ephemeral: true });
    }

    const userId = interaction.user.id;
    const cashAmount = parseInt(interaction.fields.getTextInputValue('cash_amount'));

    if (isNaN(cashAmount) || cashAmount <= 0) {
      return await interaction.reply({ content: 'Please enter a valid cash amount!', ephemeral: true });
    }

    if (cashAmount > userData[userId].cash) {
      return await interaction.reply({ content: `You only have $${userData[userId].cash.toLocaleString()} available!`, ephemeral: true });
    }

    const isInitiator = trade.initiator === userId;
    if (isInitiator) {
      trade.initiatorOffer.cash = cashAmount;
      trade.initiatorReady = false;
    } else {
      trade.recipientOffer.cash = cashAmount;
      trade.recipientReady = false;
    }

    const tradeEmbed = createTradeEmbed(trade, trade.initiator, trade.recipient);
    const components = createTradeComponents(tradeId, userId);

    await interaction.update({ embeds: [tradeEmbed], components });

  } else if (customId.startsWith('trade_artefact_select_')) {
    const tradeId = customId.split('_')[3];
    const trade = global.activeTrades[tradeId];
    if (!trade) {
      return await interaction.reply({ content: '❌ Trade session not found!', ephemeral: true });
    }

    const userId = interaction.user.id;
    const artefactIndex = parseInt(interaction.values[0]);
    const artefact = userData[userId].artefacts[artefactIndex];

    if (!artefact) {
      return await interaction.reply({ content: '❌ Artefact not found in your inventory!', ephemeral: true });
    }

    const isInitiator = trade.initiator === userId;
    if (isInitiator) {
      if (!trade.initiatorOffer.artefacts.includes(artefact)) {
        trade.initiatorOffer.artefacts.push(artefact);
      }
      trade.initiatorReady = false;
    } else {
      if (!trade.recipientOffer.artefacts.includes(artefact)) {
        trade.recipientOffer.artefacts.push(artefact);
      }
      trade.recipientReady = false;
    }

    const tradeEmbed = createTradeEmbed(trade, trade.initiator, trade.recipient);
    const components = createTradeComponents(tradeId, userId);

    await interaction.update({ embeds: [tradeEmbed], components });

  } else if (customId.startsWith('trade_remove_artefact_select_')) {
    const tradeId = customId.split('_')[4];
    const trade = global.activeTrades[tradeId];
    if (!trade) return;

    const userId = interaction.user.id;
    const artefactIndex = parseInt(interaction.values[0]);
    const isInitiator = trade.initiator === userId;

    if (isInitiator) {
      trade.initiatorOffer.artefacts.splice(artefactIndex, 1);
      trade.initiatorReady = false;
    } else {
      trade.recipientOffer.artefacts.splice(artefactIndex, 1);
      trade.recipientReady = false;
    }

    const tradeEmbed = createTradeEmbed(trade, trade.initiator, trade.recipient);
    const components = createTradeComponents(tradeId, userId);

    await interaction.update({ 
      content: 'Artefact removed from your offer!', 
      embeds: [tradeEmbed], 
      components 
    });

  } else if (customId.startsWith('convert_accept_')) {
    const userId = customId.replace('convert_accept_', '');

    if (interaction.user.id !== userId) {
      return await interaction.reply({ 
        content: '❌ This conversion is not for you!', 
        ephemeral: true 
      });
    }

    const userXpData = userData[userId].xpData;
    if (!userXpData || userXpData.xp === 0) {
      return await interaction.reply({ 
        content: '❌ You have no XP to convert!', 
        ephemeral: true 
      });
    }

    const xpToConvert = userXpData.xp;
    const cashEarned = xpToConvert * 2;

    // Convert XP to cash
    userData[userId].cash += cashEarned;
    userData[userId].xpData.xp = 0;
    await saveUserData();

    const successEmbed = new EmbedBuilder()
      .setTitle('XP Conversion Successful')
      .setDescription('Your XP has been successfully converted to cash!')
      .addFields(
        { name: 'XP Converted', value: `${xpToConvert.toLocaleString()} XP`, inline: true },
        { name: 'Cash Earned', value: `$${cashEarned.toLocaleString()}`, inline: true },
        { name: 'New Cash Total', value: `$${userData[userId].cash.toLocaleString()}`, inline: true }
      )
      .setColor(0x00FF7F)
      .setTimestamp();

    await interaction.update({ embeds: [successEmbed], components: [] });

  } else if (customId.startsWith('convert_decline_')) {
    const userId = customId.replace('convert_decline_', '');

    if (interaction.user.id !== userId) {
      return await interaction.reply({ 
        content: '❌ This conversion is not for you!', 
        ephemeral: true 
      });
    }

    const declineEmbed = new EmbedBuilder()
      .setTitle('XP Conversion Cancelled')
      .setDescription('You have chosen to keep your XP. You can convert it later using `/convert`.')
      .setColor(0xFF9F43)
      .setTimestamp();

    await interaction.update({ embeds: [declineEmbed], components: [] });

  } else if (customId.startsWith('collection_prev_') || customId.startsWith('collection_next_')) {
    const isPrev = customId.startsWith('collection_prev_');
    const parts = customId.split('_');
    const ownerId = parts[2];
    const currentPage = parseInt(parts[3]);

    if (interaction.user.id !== ownerId) {
      return await interaction.reply({
        content: '❌ This is not your field guide!',
        ephemeral: true
      });
    }

    const newPage = isPrev ? currentPage - 1 : currentPage + 1;
    const user = await getUser(ownerId);
    const embed = buildCollectionPage(user, newPage);
    const components = buildCollectionButtons(ownerId, newPage);
    await interaction.update({ embeds: [embed], components });

  }

  } catch (error) {
    console.error('Component interaction error:', error);

    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ 
          content: '❌ An error occurred while processing your request. Please try again.', 
          ephemeral: true 
        });
      }
    } catch (replyError) {
      console.error('Failed to send error response:', replyError);
    }
  }
}

// New Trade System Functions
async function startInteractiveTrade(interaction, initiatorId, recipientId, tradeId) {
  const trade = global.activeTrades[tradeId];
  if (!trade) return;

  const tradeEmbed = createTradeEmbed(trade, initiatorId, recipientId);
  const components = createTradeComponents(tradeId, interaction.user.id);

  await interaction.update({ embeds: [tradeEmbed], components });
}

function calcOfferValue(offer) {
  let total = offer.cash;
  for (const name of offer.artefacts) {
    const rarity = getRarityByArtefact(name);
    total += calcArtefactSellValue(name, rarity);
  }
  return total;
}

function formatOfferDetailed(offer) {
  const lines = [];
  if (offer.cash > 0) lines.push(`Cash — $${offer.cash.toLocaleString()}`);
  for (const name of offer.artefacts) {
    const rarity = getRarityByArtefact(name);
    const tier = getArtefactTier(name);
    const val = calcArtefactSellValue(name, rarity);
    lines.push(`${name} (${rarity ? rarity.name : 'Unknown'}, T${tier}, ~$${val.toLocaleString()})`);
  }
  return lines.length > 0 ? lines.join('\n') : '*Nothing offered yet*';
}

function formatOffer(offer) {
  const parts = [];
  if (offer.cash > 0) parts.push(`$${offer.cash.toLocaleString()}`);
  if (offer.artefacts.length > 0) parts.push(offer.artefacts.join(', '));
  return parts.join('\n') || 'Nothing';
}

function createTradeEmbed(trade, initiatorId, recipientId) {
  const initiatorOfferText = formatOfferDetailed(trade.initiatorOffer);
  const recipientOfferText = formatOfferDetailed(trade.recipientOffer);
  const initiatorValue = calcOfferValue(trade.initiatorOffer);
  const recipientValue = calcOfferValue(trade.recipientOffer);

  const initiatorStatus = trade.initiatorReady ? '**Ready**' : 'Preparing offer';
  const recipientStatus = trade.recipientReady ? '**Ready**' : 'Preparing offer';

  return new EmbedBuilder()
    .setTitle('Trade Session')
    .setDescription('Both parties may add artefacts and cash. Once both mark Ready, the trade executes automatically.')
    .addFields(
      {
        name: `Initiator Offer  —  est. $${initiatorValue.toLocaleString()}`,
        value: initiatorOfferText,
        inline: true
      },
      {
        name: `Recipient Offer  —  est. $${recipientValue.toLocaleString()}`,
        value: recipientOfferText,
        inline: true
      },
      {
        name: 'Player Status',
        value: `<@${initiatorId}>  —  ${initiatorStatus}\n<@${recipientId}>  —  ${recipientStatus}`,
        inline: false
      }
    )
    .setColor(trade.initiatorReady && trade.recipientReady ? 0x00FF7F : 0x1a3a5c)
    .setFooter({ text: 'Trade expires after 10 minutes of inactivity' })
    .setTimestamp();
}

function getTradeStatus(trade) {
  if (trade.initiatorReady && trade.recipientReady) return '**Both players ready** — Trade will complete automatically';
  if (trade.initiatorReady) return 'Initiator ready, waiting for recipient';
  if (trade.recipientReady) return 'Recipient ready, waiting for initiator';
  return 'Setting up offers...';
}

function createTradeComponents(tradeId, userId) {
  const trade = global.activeTrades[tradeId];
  if (!trade) return [];

  const isInitiator = trade.initiator === userId;
  const userOffer = isInitiator ? trade.initiatorOffer : trade.recipientOffer;
  const userReady = isInitiator ? trade.initiatorReady : trade.recipientReady;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`trade_add_cash_${tradeId}`)
      .setLabel('Add Cash')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(userReady),
    new ButtonBuilder()
      .setCustomId(`trade_add_artefact_${tradeId}`)
      .setLabel('Add Artefact')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(userReady),
    new ButtonBuilder()
      .setCustomId(`trade_remove_cash_${tradeId}`)
      .setLabel('Remove Cash')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(userOffer.cash === 0 || userReady),
    new ButtonBuilder()
      .setCustomId(`trade_remove_artefact_${tradeId}`)
      .setLabel('Remove Artefact')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(userOffer.artefacts.length === 0 || userReady)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`trade_ready_${tradeId}`)
      .setLabel(userReady ? 'Ready!' : 'Mark Ready')
      .setStyle(userReady ? ButtonStyle.Success : ButtonStyle.Primary)
      .setDisabled(userReady),
    new ButtonBuilder()
      .setCustomId(`trade_cancel_${tradeId}`)
      .setLabel('Cancel Trade')
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2];
}

async function handleTradeAddCash(interaction, customId) {
  const tradeId = customId.split('_')[3];
  const trade = global.activeTrades[tradeId];
  if (!trade) return;

  const userId = interaction.user.id;
  const isInitiator = trade.initiator === userId;

  if ((isInitiator && trade.initiatorReady) || (!isInitiator && trade.recipientReady)) {
    return await interaction.reply({ content: 'You cannot modify your offer after marking ready!', ephemeral: true });
  }

  const modal = new ModalBuilder()
    .setCustomId(`trade_cash_modal_${tradeId}`)
    .setTitle('Add Cash to Trade');

  const cashInput = new TextInputBuilder()
    .setCustomId('cash_amount')
    .setLabel('Cash amount to add')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Enter amount in dollars')
    .setRequired(true)
    .setMaxLength(10);

  const row = new ActionRowBuilder().addComponents(cashInput);
  modal.addComponents(row);

  await interaction.showModal(modal);
}

async function handleTradeAddArtefact(interaction, customId) {
  const tradeId = customId.split('_')[3];
  const trade = global.activeTrades[tradeId];
  if (!trade) return;

  const userId = interaction.user.id;
  const userArtefacts = userData[userId].artefacts || [];

  if (userArtefacts.length === 0) {
    return await interaction.reply({ content: 'You have no artefacts to trade!', ephemeral: true });
  }

  const options = userArtefacts.slice(0, 25).map((artefact, index) => {
    const rarity = getRarityByArtefact(artefact);
    const tier = getArtefactTier(artefact);
    const sellVal = calcArtefactSellValue(artefact, rarity);
    return {
      label: artefact,
      description: `${rarity ? rarity.name : 'Unknown'} T${tier} — $${sellVal.toLocaleString()} sell value`,
      value: index.toString()
    };
  });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`trade_artefact_select_${tradeId}`)
    .setPlaceholder('Choose an artefact to add')
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.reply({ content: 'Select an artefact to add to your trade offer:', components: [row], ephemeral: true });
}

async function handleTradeRemoveCash(interaction, customId) {
  const tradeId = customId.split('_')[3];
  const trade = global.activeTrades[tradeId];
  if (!trade) return;

  const userId = interaction.user.id;
  const isInitiator = trade.initiator === userId;

  if (isInitiator) {
    trade.initiatorOffer.cash = 0;
    trade.initiatorReady = false;
  } else {
    trade.recipientOffer.cash = 0;
    trade.recipientReady = false;
  }

  const tradeEmbed = createTradeEmbed(trade, trade.initiator, trade.recipient);
  const components = createTradeComponents(tradeId, userId);

  await interaction.update({ embeds: [tradeEmbed], components });
}

async function handleTradeRemoveArtefact(interaction, customId) {
  const tradeId = customId.split('_')[3];
  const trade = global.activeTrades[tradeId];
  if (!trade) return;

  const userId = interaction.user.id;
  const isInitiator = trade.initiator === userId;

  const userOffer = isInitiator ? trade.initiatorOffer : trade.recipientOffer;

  if (userOffer.artefacts.length === 0) {
    return await interaction.reply({ 
      content: 'You have no artefacts in your offer to remove!', 
      ephemeral: true 
    });
  }

  // Create select menu to choose which artefact to remove
  const options = userOffer.artefacts.slice(0, 25).map((artefact, index) => {
    const rarity = getRarityByArtefact(artefact);
    return {
      label: artefact,
      description: `${rarity ? rarity.name : 'Unknown'} - Remove from offer`,
      value: index.toString()
    };
  });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`trade_remove_artefact_select_${tradeId}`)
    .setPlaceholder('Choose an artefact to remove')
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.reply({ 
    content: 'Select an artefact to remove from your trade offer:', 
    components: [row], 
    ephemeral: true 
  });
}

async function handleTradeReady(interaction, customId) {
  const tradeId = customId.split('_')[2];
  const trade = global.activeTrades[tradeId];
  if (!trade) return;

  const userId = interaction.user.id;
  const isInitiator = trade.initiator === userId;

  // Validate that user has the items they're offering
  const userOffer = isInitiator ? trade.initiatorOffer : trade.recipientOffer;

  // Check cash availability
  if (userOffer.cash > userData[userId].cash) {
    return await interaction.reply({ 
      content: `❌ You don't have enough cash! You're offering $${userOffer.cash.toLocaleString()} but only have $${userData[userId].cash.toLocaleString()}`, 
      ephemeral: true 
    });
  }

  // Check artefact availability
  for (const artefact of userOffer.artefacts) {
    if (!userData[userId].artefacts.includes(artefact)) {
      return await interaction.reply({ 
        content: `❌ You no longer have "${artefact}" in your inventory!`, 
        ephemeral: true 
      });
    }
  }

  if (isInitiator) {
    trade.initiatorReady = true;
  } else {
    trade.recipientReady = true;
  }

  if (trade.initiatorReady && trade.recipientReady) {
    await executeTrade(interaction, trade, tradeId);
  } else {
    const tradeEmbed = createTradeEmbed(trade, trade.initiator, trade.recipient);
    const components = createTradeComponents(tradeId, userId);
    await interaction.update({ embeds: [tradeEmbed], components });
  }
}

async function executeTrade(interaction, trade, tradeId) {
  const initiator = userData[trade.initiator];
  const recipient = userData[trade.recipient];

  try {
    // Final validation before executing trade
    if (trade.initiatorOffer.cash > initiator.cash) {
      throw new Error(`Initiator doesn't have enough cash`);
    }
    if (trade.recipientOffer.cash > recipient.cash) {
      throw new Error(`Recipient doesn't have enough cash`);
    }

    // Validate artefacts exist
    for (const artefact of trade.initiatorOffer.artefacts) {
      if (!initiator.artefacts.includes(artefact)) {
        throw new Error(`Initiator doesn't have "${artefact}"`);
      }
    }
    for (const artefact of trade.recipientOffer.artefacts) {
      if (!recipient.artefacts.includes(artefact)) {
        throw new Error(`Recipient doesn't have "${artefact}"`);
      }
    }

    // Execute the trade
    // Transfer cash
    initiator.cash -= trade.initiatorOffer.cash;
    initiator.cash += trade.recipientOffer.cash;
    recipient.cash -= trade.recipientOffer.cash;
    recipient.cash += trade.initiatorOffer.cash;

    // Transfer artefacts
    trade.initiatorOffer.artefacts.forEach(artefact => {
      const index = initiator.artefacts.indexOf(artefact);
      if (index > -1) {
        initiator.artefacts.splice(index, 1);
        recipient.artefacts.push(artefact);
      }
    });

    trade.recipientOffer.artefacts.forEach(artefact => {
      const index = recipient.artefacts.indexOf(artefact);
      if (index > -1) {
        recipient.artefacts.splice(index, 1);
        initiator.artefacts.push(artefact);
      }
    });

    await saveUserData();
    delete global.activeTrades[tradeId];

    const successEmbed = new EmbedBuilder()
      .setTitle('Trade Complete')
      .setDescription('All items have been exchanged successfully.')
      .addFields(
        { name: 'Initiator Received', value: formatOffer(trade.recipientOffer) || '*Nothing*', inline: true },
        { name: 'Recipient Received', value: formatOffer(trade.initiatorOffer) || '*Nothing*', inline: true }
      )
      .setColor(0x00FF7F)
      .setTimestamp();

    await interaction.update({ embeds: [successEmbed], components: [] });

  } catch (error) {
    console.error('Trade execution error:', error);

    const errorEmbed = new EmbedBuilder()
      .setTitle('❌ Trade Failed')
      .setDescription('The trade could not be completed due to validation errors.')
      .addFields(
        { name: 'Error', value: error.message, inline: false },
        { name: 'Action Required', value: 'Please restart the trade with updated offers', inline: false }
      )
      .setColor(0xFF6B6B)
      .setTimestamp();

    await interaction.update({ embeds: [errorEmbed], components: [] });
    delete global.activeTrades[tradeId];
  }
}

async function handleTradeCancel(interaction, customId) {
  const tradeId = customId.split('_')[2];
  delete global.activeTrades[tradeId];

  const cancelEmbed = new EmbedBuilder()
    .setTitle('Trade Cancelled')
    .setDescription('The trade has been cancelled by one of the participants.')
    .setColor(0xFF9F43)
    .setTimestamp();

  await interaction.update({ embeds: [cancelEmbed], components: [] });
}

// === MARBLE GAME FUNCTIONS ===

async function handleMarbleGame(interaction) {
  const userId = interaction.user.id;
  const player2 = interaction.options.getUser('player2');
  const player3 = interaction.options.getUser('player3');
  const player4 = interaction.options.getUser('player4');

  const players = [interaction.user, player2, player3, player4];
  const uniquePlayerIds = new Set(players.map(p => p.id));

  if (uniquePlayerIds.size !== 4) {
    return await interaction.reply({ content: '❌ All four players must be different users!', ephemeral: true });
  }
  if (players.some(p => p.bot)) {
    return await interaction.reply({ content: '❌ Bots cannot participate in marble games!', ephemeral: true });
  }

  const existingGame = Object.values(global.activeMarbleGames).find(game =>
    game.players.some(p => players.some(player => player.id === p.id))
  );
  if (existingGame) {
    return await interaction.reply({ content: '❌ One or more players are already in an active marble game!', ephemeral: true });
  }

  const gameId = `${userId}_${Date.now()}`;
  global.activeMarbleGames[gameId] = {
    gameId,
    initiator: interaction.user,
    players,
    invited: [player2, player3, player4],
    accepted: [],
    declined: [],
    pendingBets: {},
    betAmount: 0,
    totalPot: 0,
    betsCollected: false,
    phase: 'invitation',
    round: 0,
    createdAt: Date.now(),
    gameMessage: null,
    roundHistory: []
  };

  const invitationEmbed = createInvitationEmbed(global.activeMarbleGames[gameId]);
  const buttons = createInvitationButtons(gameId);

  await interaction.reply({ embeds: [invitationEmbed], components: [buttons] });

  // Auto-expire invitation after 2 minutes
  setTimeout(() => {
    const game = global.activeMarbleGames[gameId];
    if (game && game.phase === 'invitation') {
      delete global.activeMarbleGames[gameId];
      interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('⏰ Marble Game Expired')
            .setDescription('The invitation was not accepted by all players in time.')
            .setColor(0x99AAB5)
            .setTimestamp()
        ],
        components: []
      }).catch(() => {});
    }
  }, 120000);
}

function marbleBar(count, max = 10) {
  const filled = Math.round((count / max) * 10);
  const empty = 10 - filled;
  return '🟣'.repeat(Math.max(0, filled)) + '⬛'.repeat(Math.max(0, empty)) + ` **${count}**`;
}

function createInvitationEmbed(game) {
  const pending = game.invited.filter(p =>
    !game.accepted.includes(p.id) && !game.declined.includes(p.id)
  );
  const accepted = game.accepted;

  return new EmbedBuilder()
    .setTitle('🎲 Marble Game — Challenge Issued')
    .setDescription(
      `**${game.initiator.displayName}** has challenged three players to a marble gambling match!\n\n` +
      `All invited players must accept within **2 minutes** to begin.`
    )
    .addFields(
      {
        name: '👑 Host',
        value: `<@${game.initiator.id}>`,
        inline: true
      },
      {
        name: '✅ Accepted',
        value: accepted.length > 0 ? accepted.map(id => `<@${id}>`).join('\n') : '*None yet*',
        inline: true
      },
      {
        name: '⏳ Waiting On',
        value: pending.length > 0 ? pending.map(p => `<@${p.id}>`).join('\n') : '*All responded!*',
        inline: true
      },
      {
        name: '📖 How It Works',
        value:
          '> • 4 players split into **2 teams of 2**\n' +
          '> • Each team starts with **5 marbles** (10 total)\n' +
          '> • Each round, both teams pick secret numbers **(1–20)**\n' +
          '> • A random number is drawn — whoever guessed it **steals a marble** from the other team\n' +
          '> • First team to collect **all 10** (or drain the other to 0) wins the pot\n' +
          '> • Matching guesses are a tie — no transfer that round',
        inline: false
      }
    )
    .setColor(0xFF6B35)
    .setFooter({ text: '⏰ Invitation expires in 2 minutes' })
    .setTimestamp();
}

function createInvitationButtons(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`marble_accept_${gameId}`)
      .setLabel('✅ Accept Challenge')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`marble_decline_${gameId}`)
      .setLabel('❌ Decline')
      .setStyle(ButtonStyle.Danger)
  );
}

async function startBettingPhase(interaction, gameId) {
  const game = global.activeMarbleGames[gameId];
  if (!game) return;

  game.phase = 'betting';

  const bettingEmbed = new EmbedBuilder()
    .setTitle('💰 Betting Phase')
    .setDescription(
      'All **4 players** must place their bets.\n' +
      'Every player must bet the **same amount** — if bets mismatch, they reset and you try again.'
    )
    .addFields(
      {
        name: '🎮 Players',
        value: game.players.map(p => `<@${p.id}>`).join('\n'),
        inline: true
      },
      {
        name: '🎯 Bets Placed',
        value: '*None yet*',
        inline: true
      },
      {
        name: '📋 Rules',
        value: '• Minimum bet: **$50**\n• All bets must match\n• Winning team splits the **full pot**',
        inline: false
      }
    )
    .setColor(0xFFD700)
    .setTimestamp();

  const betButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`place_bet_${gameId}`)
      .setLabel('💸 Place Bet')
      .setStyle(ButtonStyle.Primary)
  );

  // interaction here is a button interaction (accept button) — must use update()
  await interaction.update({ embeds: [bettingEmbed], components: [betButton] });
}

async function handleBetModalSubmit(interaction, gameId) {
  const game = global.activeMarbleGames[gameId];
  if (!game) {
    return interaction.reply({ content: '❌ This game is no longer active.', ephemeral: true });
  }

  const userId = interaction.user.id;

  if (!game.players.some(p => p.id === userId)) {
    return interaction.reply({ content: '❌ You are not part of this game.', ephemeral: true });
  }

  if (game.pendingBets[userId] !== undefined) {
    return interaction.reply({ content: '❌ You have already placed your bet for this round.', ephemeral: true });
  }

  const betAmount = parseInt(interaction.fields.getTextInputValue('bet_amount_input'));

  if (isNaN(betAmount) || betAmount < 50) {
    return interaction.reply({ content: '❌ Minimum bet is **$50**. Please try again.', ephemeral: true });
  }

  await getUser(userId);
  if (userData[userId].cash < betAmount) {
    return interaction.reply({
      content: `❌ You only have **$${userData[userId].cash.toLocaleString()}** — not enough to bet $${betAmount.toLocaleString()}.`,
      ephemeral: true
    });
  }

  game.pendingBets[userId] = betAmount;

  const betsPlaced = Object.entries(game.pendingBets)
    .map(([id, bet]) => `<@${id}> → **$${bet.toLocaleString()}**`)
    .join('\n');
  const waiting = game.players.filter(p => game.pendingBets[p.id] === undefined);

  const updatedEmbed = new EmbedBuilder()
    .setTitle('💰 Betting Phase')
    .setDescription(
      Object.keys(game.pendingBets).length === game.players.length
        ? '✅ All bets received! Checking if they match...'
        : `Waiting for **${waiting.length}** more player(s) to bet...`
    )
    .addFields(
      {
        name: '✅ Bets Placed',
        value: betsPlaced,
        inline: true
      },
      {
        name: '⏳ Still Waiting',
        value: waiting.length > 0 ? waiting.map(p => `<@${p.id}>`).join('\n') : '*All in!*',
        inline: true
      }
    )
    .setColor(0xFFD700)
    .setTimestamp();

  // Use deferUpdate + message edit since this is a modal submit from a component
  await interaction.deferUpdate();
  await interaction.message.edit({ embeds: [updatedEmbed] });

  if (Object.keys(game.pendingBets).length === game.players.length) {
    const allBets = Object.values(game.pendingBets);
    const firstBet = allBets[0];

    if (allBets.every(b => b === firstBet)) {
      game.betAmount = firstBet;
      game.totalPot = firstBet * game.players.length;
      await collectBets(game);

      setTimeout(() => startMarbleGame(interaction, gameId), 1500);
    } else {
      game.pendingBets = {};
      const mismatchEmbed = new EmbedBuilder()
        .setTitle('💸 Bets Mismatch!')
        .setDescription(
          `Bets were not equal — all bets have been **reset**.\n` +
          `Everyone must bet the **same amount**. Click **Place Bet** to try again.`
        )
        .addFields({ name: 'Previous Bets', value: betsPlaced })
        .setColor(0xFF6B6B)
        .setTimestamp();

      const betButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`place_bet_${gameId}`)
          .setLabel('💸 Place Bet')
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.message.edit({ embeds: [mismatchEmbed], components: [betButton] });
    }
  }
}

async function collectBets(game) {
  if (game.betsCollected) return;
  for (const player of game.players) {
    if (userData[player.id]) userData[player.id].cash -= game.betAmount;
  }
  game.betsCollected = true;
  await saveUserData();
}

async function startMarbleGame(interaction, gameId) {
  const game = global.activeMarbleGames[gameId];
  if (!game) return;

  const shuffledPlayers = [...game.players].sort(() => Math.random() - 0.5);
  game.teamA = shuffledPlayers.slice(0, 2);
  game.teamB = shuffledPlayers.slice(2, 4);
  game.teamAMarbles = 5;
  game.teamBMarbles = 5;
  game.phase = 'game';
  game.round = 1;
  game.playerGuesses = {};
  game.roundHistory = [];

  const coinFlip = Math.random() < 0.5 ? 'heads' : 'tails';
  game.currentTeam = coinFlip === 'heads' ? 'A' : 'B';
  game.firstTeam = game.currentTeam; // track which team voted first this round
  game.currentPlayerIndex = 0;
  game.channel = interaction.channel;

  const gameStartEmbed = createGameEmbed(game, coinFlip);
  const numberButton = createNumberSelectionButton(gameId);

  const msg = await game.channel.send({ embeds: [gameStartEmbed], components: [numberButton] });
  game.gameMessage = msg;
}

// Delete existing game message and send a fresh one at the bottom of the channel
async function refreshGameMessage(game, embeds, components) {
  if (game.gameMessage) {
    try { await game.gameMessage.delete(); } catch (_) {}
    game.gameMessage = null;
  }
  if (game.channel) {
    game.gameMessage = await game.channel.send({ embeds, components: components ?? [] });
  }
}

function createGameEmbed(game, coinFlip = null) {
  const currentTeamArr = game.currentTeam === 'A' ? game.teamA : game.teamB;
  const currentPlayer = currentTeamArr[game.currentPlayerIndex];

  const guessedA = game.teamA.filter(p => game.playerGuesses[p.id] !== undefined).length;
  const guessedB = game.teamB.filter(p => game.playerGuesses[p.id] !== undefined).length;

  let description = `**Round ${game.round}**`;
  if (coinFlip) {
    description += `\n\n🪙 Coin flip: **${coinFlip.toUpperCase()}** — Team ${game.currentTeam} goes first!`;
  }
  description += `\n\n🔴 Team A guessed: **${guessedA}/2** | 🔵 Team B guessed: **${guessedB}/2**`;

  return new EmbedBuilder()
    .setTitle('🎲 Marble Game — In Progress')
    .setDescription(description)
    .addFields(
      {
        name: '🔴 Team A',
        value: `${game.teamA.map(p => `<@${p.id}>`).join(' & ')}\n${marbleBar(game.teamAMarbles)}`,
        inline: true
      },
      {
        name: '🔵 Team B',
        value: `${game.teamB.map(p => `<@${p.id}>`).join(' & ')}\n${marbleBar(game.teamBMarbles)}`,
        inline: true
      },
      {
        name: `🎯 It's ${currentPlayer.displayName}'s Turn (Team ${game.currentTeam})`,
        value: 'Click the button below to secretly choose your number **(1–20)**.',
        inline: false
      }
    )
    .setColor(game.currentTeam === 'A' ? 0xFF4444 : 0x4466FF)
    .setFooter({ text: `Round ${game.round} • Pot: $${game.totalPot.toLocaleString()} • ${game.roundHistory.length} rounds played` })
    .setTimestamp();
}

function createNumberSelectionButton(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`select_number_${gameId}`)
      .setLabel('🎯 Choose Your Number (1–20)')
      .setStyle(ButtonStyle.Primary)
  );
}

async function handleNumberSelection(interaction, gameId) {
  const game = global.activeMarbleGames[gameId];
  if (!game || game.phase !== 'game') return;

  const currentTeamArr = game.currentTeam === 'A' ? game.teamA : game.teamB;
  const currentPlayer = currentTeamArr[game.currentPlayerIndex];

  if (interaction.user.id !== currentPlayer.id) {
    return interaction.reply({ content: `❌ It's not your turn! Waiting for **${currentPlayer.displayName}**.`, ephemeral: true });
  }

  const modal = new ModalBuilder()
    .setCustomId(`number_modal_${gameId}`)
    .setTitle(`Round ${game.round} — Pick Your Number`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('number_input')
          .setLabel('Enter a number from 1 to 20')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(2)
          .setRequired(true)
          .setPlaceholder('e.g. 7')
      )
    );

  await interaction.showModal(modal);
}

async function processNumberGuess(interaction, gameId) {
  const game = global.activeMarbleGames[gameId];
  if (!game || game.phase !== 'game') return;

  const number = parseInt(interaction.fields.getTextInputValue('number_input'));

  if (isNaN(number) || number < 1 || number > 20) {
    return interaction.reply({ content: '❌ Invalid number — must be between **1 and 20**.', ephemeral: true });
  }

  const playerId = interaction.user.id;

  // Verify it is actually this player's turn
  const currentTeamArr = game.currentTeam === 'A' ? game.teamA : game.teamB;
  const currentPlayer = currentTeamArr[game.currentPlayerIndex];
  if (playerId !== currentPlayer.id) {
    return interaction.reply({ content: `❌ It's not your turn right now. Waiting for **${currentPlayer.displayName}**.`, ephemeral: true });
  }

  game.playerGuesses[playerId] = number;

  await interaction.reply({ content: `✅ You locked in **${number}**. Keep it secret!`, ephemeral: true });

  game.currentPlayerIndex++;

  if (game.currentPlayerIndex >= currentTeamArr.length) {
    // Current team has finished voting
    const otherTeam = game.currentTeam === 'A' ? 'B' : 'A';

    if (game.currentTeam === game.firstTeam) {
      // First team is done — switch to the second team
      game.currentTeam = otherTeam;
      game.currentPlayerIndex = 0;
    } else {
      // Second team is done — all 4 players have voted, run the draw
      await runRandomizer(gameId);
      return;
    }
  }

  // Update the game message: delete old and resend at bottom
  const updatedEmbed = createGameEmbed(game);
  const numberButton = createNumberSelectionButton(gameId);
  await refreshGameMessage(game, [updatedEmbed], [numberButton]);
}

async function runRandomizer(gameId) {
  const game = global.activeMarbleGames[gameId];
  if (!game) return;

  const guesses = game.playerGuesses;
  const allGuessedNumbers = Object.values(guesses);
  const uniqueGuesses = [...new Set(allGuessedNumbers)];

  // Delete old message and send fresh one for the rolling animation
  if (game.gameMessage) {
    try { await game.gameMessage.delete(); } catch (_) {}
    game.gameMessage = null;
  }

  let drawnNumber;
  let rollLog = [];
  let attempts = 0;

  // Send initial rolling message
  if (game.channel) {
    const initialEmbed = new EmbedBuilder()
      .setTitle('🎲 Drawing Numbers...')
      .setDescription('All players have cast their votes!\n\nRolling...')
      .setColor(0xFFA500)
      .setTimestamp();
    game.gameMessage = await game.channel.send({ embeds: [initialEmbed], components: [] });
  }

  do {
    drawnNumber = Math.floor(Math.random() * 20) + 1;
    attempts++;

    if (!uniqueGuesses.includes(drawnNumber)) {
      rollLog.push(`~~${drawnNumber}~~`);

      if (game.gameMessage) {
        const rollingEmbed = new EmbedBuilder()
          .setTitle('🎲 Drawing Numbers...')
          .setDescription(
            `Rolled: ${rollLog.join('  ')}\n\n` +
            `**${drawnNumber}** — no match! Re-rolling...`
          )
          .setColor(0xFFA500)
          .setTimestamp();
        await game.gameMessage.edit({ embeds: [rollingEmbed], components: [] });
        await new Promise(r => setTimeout(r, 1100));
      }
    }

    if (attempts >= 80) {
      drawnNumber = uniqueGuesses[Math.floor(Math.random() * uniqueGuesses.length)];
      break;
    }
  } while (!uniqueGuesses.includes(drawnNumber));

  // Find all players who guessed this number
  const winnerIds = Object.keys(guesses).filter(id => guesses[id] === drawnNumber);

  // Check if it's a cross-team tie
  const teamAWinners = winnerIds.filter(id => game.teamA.some(p => p.id === id));
  const teamBWinners = winnerIds.filter(id => game.teamB.some(p => p.id === id));
  const isTie = teamAWinners.length > 0 && teamBWinners.length > 0;

  if (isTie) {
    game.roundHistory.push({ round: game.round, drawn: drawnNumber, result: 'tie' });

    const missedLog = rollLog.length > 0 ? `\nMisses: ${rollLog.join('  ')}` : '';
    const tieEmbed = new EmbedBuilder()
      .setTitle('🤝 Tie Round!')
      .setDescription(
        `The draw landed on **${drawnNumber}** — but **both teams** had someone guess it!\n` +
        `No marbles are transferred.${missedLog}`
      )
      .addFields(buildScoreField(game), buildGuessField(game, guesses))
      .setColor(0xFFD700)
      .setTimestamp();

    if (game.gameMessage) await game.gameMessage.edit({ embeds: [tieEmbed], components: [] });
    setTimeout(() => nextRound(gameId), 4000);
    return;
  }

  if (winnerIds.length === 0) {
    game.roundHistory.push({ round: game.round, drawn: drawnNumber, result: 'no_match' });
    setTimeout(() => nextRound(gameId), 4000);
    return;
  }

  const winnerId = winnerIds[0];
  const winnerUser = game.players.find(p => p.id === winnerId);
  const winnerTeam = teamAWinners.length > 0 ? 'A' : 'B';

  if (winnerTeam === 'A') {
    game.teamAMarbles++;
    game.teamBMarbles--;
  } else {
    game.teamBMarbles++;
    game.teamAMarbles--;
  }

  game.roundHistory.push({ round: game.round, drawn: drawnNumber, winner: winnerUser.displayName, team: winnerTeam });

  const missedLog = rollLog.length > 0 ? `\nMisses: ${rollLog.join('  ')}` : '';
  const resultEmbed = new EmbedBuilder()
    .setTitle(`🎯 Round ${game.round} — Result`)
    .setDescription(
      `The draw landed on **${drawnNumber}**!${missedLog}\n\n` +
      `**${winnerUser.displayName}** (Team ${winnerTeam}) wins the round and steals a marble! 🪙`
    )
    .addFields(buildScoreField(game), buildGuessField(game, guesses))
    .setColor(winnerTeam === 'A' ? 0xFF4444 : 0x4466FF)
    .setTimestamp();

  if (game.gameMessage) await game.gameMessage.edit({ embeds: [resultEmbed], components: [] });

  const isOver = game.teamAMarbles <= 0 || game.teamBMarbles <= 0 || game.teamAMarbles >= 10 || game.teamBMarbles >= 10;
  if (isOver) {
    setTimeout(() => endGame(gameId), 4000);
  } else {
    setTimeout(() => nextRound(gameId), 5000);
  }
}

function buildScoreField(game) {
  return {
    name: '📊 Current Scores',
    value: `🔴 Team A: ${marbleBar(game.teamAMarbles)}\n🔵 Team B: ${marbleBar(game.teamBMarbles)}`,
    inline: false
  };
}

function buildGuessField(game, guesses) {
  const lines = [...game.teamA, ...game.teamB].map(p => {
    const g = guesses[p.id];
    return `<@${p.id}> → **${g !== undefined ? g : '?'}**`;
  });
  return { name: '🔢 All Guesses This Round', value: lines.join('\n'), inline: false };
}

async function nextRound(gameId) {
  const game = global.activeMarbleGames[gameId];
  if (!game) return;

  game.round++;
  game.playerGuesses = {};

  const coinFlip = Math.random() < 0.5 ? 'heads' : 'tails';
  game.currentTeam = coinFlip === 'heads' ? 'A' : 'B';
  game.firstTeam = game.currentTeam; // reset first team for this round
  game.currentPlayerIndex = 0;

  const nextRoundEmbed = createGameEmbed(game, coinFlip);
  const numberButton = createNumberSelectionButton(game.gameId);

  // Delete old message and send fresh one at the bottom
  await refreshGameMessage(game, [nextRoundEmbed], [numberButton]);
}

async function endGame(gameId) {
  const game = global.activeMarbleGames[gameId];
  if (!game) return;

  const winningTeam = (game.teamAMarbles >= 10 || game.teamBMarbles <= 0) ? 'A' : 'B';
  const losingTeam = winningTeam === 'A' ? 'B' : 'A';
  const winningPlayers = winningTeam === 'A' ? game.teamA : game.teamB;
  const losingPlayers = losingTeam === 'A' ? game.teamA : game.teamB;
  const finalScoreA = game.teamAMarbles;
  const finalScoreB = game.teamBMarbles;

  const winningsPerPlayer = game.totalPot / 2;
  for (const player of winningPlayers) {
    if (userData[player.id]) userData[player.id].cash += winningsPerPlayer;
  }
  await saveUserData();

  const duration = Math.max(1, Math.round((Date.now() - game.createdAt) / 60000));

  const gameEndEmbed = new EmbedBuilder()
    .setTitle(`🏆 Team ${winningTeam} Wins the Marble Game!`)
    .setDescription(
      `After **${game.round} rounds**, Team ${winningTeam} dominated!\n\n` +
      `🏅 **Winners:** ${winningPlayers.map(p => `<@${p.id}>`).join(' & ')}\n` +
      `💀 **Eliminated:** ${losingPlayers.map(p => `<@${p.id}>`).join(' & ')}`
    )
    .addFields(
      {
        name: '📊 Final Score',
        value: `🔴 Team A: ${marbleBar(finalScoreA)}\n🔵 Team B: ${marbleBar(finalScoreB)}`,
        inline: false
      },
      {
        name: '💰 Prize',
        value: `Each winner receives **$${winningsPerPlayer.toLocaleString()}**\nTotal pot: **$${game.totalPot.toLocaleString()}**`,
        inline: true
      },
      {
        name: '📈 Game Stats',
        value: `Rounds played: **${game.round}**\nDuration: **${duration} min**`,
        inline: true
      }
    )
    .setColor(0xFFD700)
    .setFooter({ text: 'Winnings distributed! Thanks for playing.' })
    .setTimestamp();

  // Send final message fresh at the bottom
  await refreshGameMessage(game, [gameEndEmbed], []);

  delete global.activeMarbleGames[gameId];
}

// =============================================
// === MARBLE DUEL — 1v1 GAME SYSTEM ===
// =============================================

async function handleMarbleDuel(interaction) {
  const userId = interaction.user.id;
  const opponent = interaction.options.getUser('opponent');

  if (opponent.id === userId) {
    return interaction.reply({ content: '❌ You cannot challenge yourself to a duel!', ephemeral: true });
  }
  if (opponent.bot) {
    return interaction.reply({ content: '❌ Bots cannot participate in marble duels!', ephemeral: true });
  }

  const allPlayers = [interaction.user, opponent];
  const alreadyInGame = allPlayers.some(u =>
    Object.values(global.activeMarbleGames).some(g => g.players.some(p => p.id === u.id)) ||
    Object.values(global.activeDuelGames).some(g => g.players.some(p => p.id === u.id))
  );
  if (alreadyInGame) {
    return interaction.reply({ content: '❌ One or more players are already in an active marble game!', ephemeral: true });
  }

  const gameId = `duel_${userId}_${Date.now()}`;
  global.activeDuelGames[gameId] = {
    gameId,
    players: [interaction.user, opponent], // [0]=P1 initiator, [1]=P2 opponent
    pendingBets: {},
    betAmount: 0,
    totalPot: 0,
    betsCollected: false,
    phase: 'invitation',
    round: 0,
    createdAt: Date.now(),
    gameMessage: null,
    channel: null,
    p1Marbles: 5,
    p2Marbles: 5,
    currentPlayerIndex: 0,
    firstPlayerIndex: 0,
    votedCount: 0,
    playerGuesses: {},
    roundHistory: []
  };

  const embed = createDuelInvitationEmbed(global.activeDuelGames[gameId]);
  const buttons = createDuelInvitationButtons(gameId);
  await interaction.reply({ embeds: [embed], components: [buttons] });

  // Auto-expire after 2 minutes
  setTimeout(() => {
    const game = global.activeDuelGames[gameId];
    if (game && game.phase === 'invitation') {
      delete global.activeDuelGames[gameId];
      interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('⏰ Marble Duel Expired')
            .setDescription('The duel invitation was not accepted in time.')
            .setColor(0x99AAB5)
            .setTimestamp()
        ],
        components: []
      }).catch(() => {});
    }
  }, 120000);
}

function createDuelInvitationEmbed(game) {
  const [p1, p2] = game.players;
  return new EmbedBuilder()
    .setTitle('⚔️ Marble Duel — Challenge Issued')
    .setDescription(
      `**${p1.displayName}** has challenged **${p2.displayName}** to a 1v1 marble duel!\n\n` +
      `**${p2.displayName}** must accept within **2 minutes** to begin.`
    )
    .addFields(
      {
        name: '⚔️ Challenger',
        value: `<@${p1.id}>`,
        inline: true
      },
      {
        name: '🎯 Opponent',
        value: `<@${p2.id}>`,
        inline: true
      },
      {
        name: '📖 How It Works',
        value:
          '> • 2 players go head-to-head, each starting with **5 marbles** (10 total)\n' +
          '> • Each round, both players secretly pick a number **(1–20)**\n' +
          '> • A random number is drawn — whoever guessed it **steals a marble** from the other\n' +
          '> • First to collect **all 10** (or drain your opponent to 0) wins the pot\n' +
          '> • Both pick the same drawn number — it\'s a tie, no transfer',
        inline: false
      }
    )
    .setColor(0xA855F7)
    .setFooter({ text: '⏰ Invitation expires in 2 minutes' })
    .setTimestamp();
}

function createDuelInvitationButtons(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`duel_accept_${gameId}`)
      .setLabel('✅ Accept Duel')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`duel_decline_${gameId}`)
      .setLabel('❌ Decline')
      .setStyle(ButtonStyle.Danger)
  );
}

async function startDuelBettingPhase(interaction, gameId) {
  const game = global.activeDuelGames[gameId];
  if (!game) return;

  game.phase = 'betting';
  const [p1, p2] = game.players;

  const embed = new EmbedBuilder()
    .setTitle('💰 Duel Betting Phase')
    .setDescription(
      'Both players must place a bet.\n' +
      'Bets must **match exactly** — if they don\'t, they reset and you try again.'
    )
    .addFields(
      {
        name: '⚔️ Challenger',
        value: `<@${p1.id}>`,
        inline: true
      },
      {
        name: '🎯 Opponent',
        value: `<@${p2.id}>`,
        inline: true
      },
      {
        name: '🎯 Bets Placed',
        value: '*None yet*',
        inline: false
      },
      {
        name: '📋 Rules',
        value: '• Minimum bet: **$50**\n• Both bets must match\n• Winner takes **the full pot**',
        inline: false
      }
    )
    .setColor(0xFFD700)
    .setTimestamp();

  const betButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`place_duel_bet_${gameId}`)
      .setLabel('💸 Place Bet')
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.update({ embeds: [embed], components: [betButton] });
}

async function handleDuelBetModal(interaction, gameId) {
  const game = global.activeDuelGames[gameId];
  if (!game) {
    return interaction.reply({ content: '❌ This duel is no longer active.', ephemeral: true });
  }

  const userId = interaction.user.id;
  if (!game.players.some(p => p.id === userId)) {
    return interaction.reply({ content: '❌ You are not part of this duel.', ephemeral: true });
  }
  if (game.pendingBets[userId] !== undefined) {
    return interaction.reply({ content: '❌ You have already placed your bet.', ephemeral: true });
  }

  const betAmount = parseInt(interaction.fields.getTextInputValue('bet_amount_input'));
  if (isNaN(betAmount) || betAmount < 50) {
    return interaction.reply({ content: '❌ Minimum bet is **$50**. Please try again.', ephemeral: true });
  }

  await getUser(userId);
  if (userData[userId].cash < betAmount) {
    return interaction.reply({
      content: `❌ You only have **$${userData[userId].cash.toLocaleString()}** — not enough to bet $${betAmount.toLocaleString()}.`,
      ephemeral: true
    });
  }

  game.pendingBets[userId] = betAmount;

  const [p1, p2] = game.players;
  const betsPlaced = Object.entries(game.pendingBets)
    .map(([id, b]) => `<@${id}> → **$${b.toLocaleString()}**`)
    .join('\n');
  const waiting = game.players.filter(p => game.pendingBets[p.id] === undefined);

  const updatedEmbed = new EmbedBuilder()
    .setTitle('💰 Duel Betting Phase')
    .setDescription(
      Object.keys(game.pendingBets).length === 2
        ? '✅ Both bets received! Checking if they match...'
        : `Waiting for **${waiting.map(p => p.displayName).join(', ')}** to bet...`
    )
    .addFields(
      { name: '✅ Bets Placed', value: betsPlaced, inline: true },
      {
        name: '⏳ Still Waiting',
        value: waiting.length > 0 ? waiting.map(p => `<@${p.id}>`).join('\n') : '*All in!*',
        inline: true
      }
    )
    .setColor(0xFFD700)
    .setTimestamp();

  await interaction.deferUpdate();
  await interaction.message.edit({ embeds: [updatedEmbed] });

  if (Object.keys(game.pendingBets).length === 2) {
    const [bet1, bet2] = game.players.map(p => game.pendingBets[p.id]);

    if (bet1 === bet2) {
      game.betAmount = bet1;
      game.totalPot = bet1 * 2;
      await collectDuelBets(game);
      setTimeout(() => startDuelGame(interaction, gameId), 1500);
    } else {
      game.pendingBets = {};
      const mismatchEmbed = new EmbedBuilder()
        .setTitle('💸 Bets Mismatch!')
        .setDescription(
          `Bets didn't match — **reset**.\nBoth players must bet the same amount. Click **Place Bet** to try again.`
        )
        .addFields({ name: 'Previous Bets', value: betsPlaced })
        .setColor(0xFF6B6B)
        .setTimestamp();

      const betButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`place_duel_bet_${gameId}`)
          .setLabel('💸 Place Bet')
          .setStyle(ButtonStyle.Primary)
      );
      await interaction.message.edit({ embeds: [mismatchEmbed], components: [betButton] });
    }
  }
}

async function collectDuelBets(game) {
  if (game.betsCollected) return;
  for (const player of game.players) {
    if (userData[player.id]) userData[player.id].cash -= game.betAmount;
  }
  game.betsCollected = true;
  await saveUserData();
}

async function startDuelGame(interaction, gameId) {
  const game = global.activeDuelGames[gameId];
  if (!game) return;

  game.p1Marbles = 5;
  game.p2Marbles = 5;
  game.phase = 'game';
  game.round = 1;
  game.playerGuesses = {};
  game.roundHistory = [];
  game.channel = interaction.channel;

  const coinFlip = Math.random() < 0.5 ? 'heads' : 'tails';
  // heads = P1 (index 0) goes first, tails = P2 (index 1) goes first
  game.currentPlayerIndex = coinFlip === 'heads' ? 0 : 1;
  game.firstPlayerIndex = game.currentPlayerIndex;
  game.votedCount = 0;

  const embed = createDuelGameEmbed(game, coinFlip);
  const pickButton = createDuelPickButton(gameId);

  const msg = await game.channel.send({ embeds: [embed], components: [pickButton] });
  game.gameMessage = msg;
}

function createDuelGameEmbed(game, coinFlip = null) {
  const [p1, p2] = game.players;
  const currentPlayer = game.players[game.currentPlayerIndex];
  const voted1 = game.playerGuesses[p1.id] !== undefined;
  const voted2 = game.playerGuesses[p2.id] !== undefined;

  let description = `**Round ${game.round}**`;
  if (coinFlip) {
    description += `\n\n🪙 Coin flip: **${coinFlip.toUpperCase()}** — **${currentPlayer.displayName}** goes first!`;
  }
  description += `\n\n${voted1 ? '✅' : '⏳'} **${p1.displayName}** | ${voted2 ? '✅' : '⏳'} **${p2.displayName}**`;

  return new EmbedBuilder()
    .setTitle('⚔️ Marble Duel — In Progress')
    .setDescription(description)
    .addFields(
      {
        name: `⚔️ ${p1.displayName}`,
        value: marbleBar(game.p1Marbles),
        inline: true
      },
      {
        name: `🎯 ${p2.displayName}`,
        value: marbleBar(game.p2Marbles),
        inline: true
      },
      {
        name: `🎯 It's ${currentPlayer.displayName}'s Turn`,
        value: 'Click the button below to secretly pick your number **(1–20)**.',
        inline: false
      }
    )
    .setColor(game.currentPlayerIndex === 0 ? 0xA855F7 : 0x22D3EE)
    .setFooter({ text: `Round ${game.round} • Pot: $${game.totalPot.toLocaleString()} • ${game.roundHistory.length} rounds played` })
    .setTimestamp();
}

function createDuelPickButton(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`duel_pick_${gameId}`)
      .setLabel('🎯 Pick Your Number (1–20)')
      .setStyle(ButtonStyle.Primary)
  );
}

async function handleDuelPick(interaction, gameId) {
  const game = global.activeDuelGames[gameId];
  if (!game || game.phase !== 'game') return;

  const currentPlayer = game.players[game.currentPlayerIndex];
  if (interaction.user.id !== currentPlayer.id) {
    return interaction.reply({
      content: `❌ It's not your turn! Waiting for **${currentPlayer.displayName}** to pick.`,
      ephemeral: true
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(`duel_number_modal_${gameId}`)
    .setTitle(`Round ${game.round} — Pick Your Number`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('number_input')
          .setLabel('Your number (1–20)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Enter a number between 1 and 20')
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(2)
      )
    );

  await interaction.showModal(modal);
}

async function processDuelGuess(interaction, gameId) {
  const game = global.activeDuelGames[gameId];
  if (!game || game.phase !== 'game') return;

  const number = parseInt(interaction.fields.getTextInputValue('number_input'));
  if (isNaN(number) || number < 1 || number > 20) {
    return interaction.reply({ content: '❌ Invalid number — must be between **1 and 20**.', ephemeral: true });
  }

  const playerId = interaction.user.id;
  const currentPlayer = game.players[game.currentPlayerIndex];
  if (playerId !== currentPlayer.id) {
    return interaction.reply({
      content: `❌ It's not your turn! Waiting for **${currentPlayer.displayName}**.`,
      ephemeral: true
    });
  }
  if (game.playerGuesses[playerId] !== undefined) {
    return interaction.reply({ content: '❌ You have already locked in your number this round.', ephemeral: true });
  }

  game.playerGuesses[playerId] = number;
  game.votedCount++;
  await interaction.reply({ content: `✅ You locked in **${number}**. Keep it secret!`, ephemeral: true });

  if (game.votedCount >= 2) {
    // Both players have voted — run the draw
    await runDuelRandomizer(gameId);
    return;
  }

  // Switch to the other player
  game.currentPlayerIndex = game.currentPlayerIndex === 0 ? 1 : 0;

  // Delete old message and resend fresh at the bottom
  const embed = createDuelGameEmbed(game);
  const pickButton = createDuelPickButton(gameId);
  await refreshDuelMessage(game, [embed], [pickButton]);
}

async function runDuelRandomizer(gameId) {
  const game = global.activeDuelGames[gameId];
  if (!game) return;

  const [p1, p2] = game.players;
  const guesses = game.playerGuesses;
  const uniqueGuesses = [...new Set(Object.values(guesses))];

  // Delete old pick message, send fresh rolling message
  if (game.gameMessage) {
    try { await game.gameMessage.delete(); } catch (_) {}
    game.gameMessage = null;
  }

  let drawnNumber;
  let rollLog = [];
  let attempts = 0;

  if (game.channel) {
    const initialEmbed = new EmbedBuilder()
      .setTitle('🎲 Drawing Numbers...')
      .setDescription(`Both players have locked in! Rolling...\n\n**${p1.displayName}** vs **${p2.displayName}**`)
      .setColor(0xFFA500)
      .setTimestamp();
    game.gameMessage = await game.channel.send({ embeds: [initialEmbed], components: [] });
  }

  do {
    drawnNumber = Math.floor(Math.random() * 20) + 1;
    attempts++;

    if (!uniqueGuesses.includes(drawnNumber)) {
      rollLog.push(`~~${drawnNumber}~~`);

      if (game.gameMessage) {
        const rollingEmbed = new EmbedBuilder()
          .setTitle('🎲 Drawing Numbers...')
          .setDescription(
            `Rolled: ${rollLog.join('  ')}\n\n` +
            `**${drawnNumber}** — no match! Re-rolling...`
          )
          .setColor(0xFFA500)
          .setTimestamp();
        await game.gameMessage.edit({ embeds: [rollingEmbed], components: [] });
        await new Promise(r => setTimeout(r, 1100));
      }
    }

    if (attempts >= 80) {
      drawnNumber = uniqueGuesses[Math.floor(Math.random() * uniqueGuesses.length)];
      break;
    }
  } while (!uniqueGuesses.includes(drawnNumber));

  const p1Guess = guesses[p1.id];
  const p2Guess = guesses[p2.id];
  const missedLog = rollLog.length > 0 ? `\nMisses: ${rollLog.join('  ')}` : '';

  // Both guessed the same number and it was drawn — tie
  if (p1Guess === drawnNumber && p2Guess === drawnNumber) {
    game.roundHistory.push({ round: game.round, drawn: drawnNumber, result: 'tie' });

    const tieEmbed = new EmbedBuilder()
      .setTitle('🤝 Tie Round!')
      .setDescription(
        `The draw landed on **${drawnNumber}** — and **both players** picked it!\n` +
        `No marbles transferred this round.${missedLog}`
      )
      .addFields(buildDuelScoreField(game), buildDuelGuessField(game, guesses))
      .setColor(0xFFD700)
      .setTimestamp();

    if (game.gameMessage) await game.gameMessage.edit({ embeds: [tieEmbed], components: [] });
    setTimeout(() => nextDuelRound(gameId), 4000);
    return;
  }

  // One player hit it (or neither — shouldn't happen after loop logic)
  const p1Won = p1Guess === drawnNumber;
  const p2Won = p2Guess === drawnNumber;

  if (!p1Won && !p2Won) {
    // Safeguard: no_match, advance without scoring
    game.roundHistory.push({ round: game.round, drawn: drawnNumber, result: 'no_match' });
    setTimeout(() => nextDuelRound(gameId), 4000);
    return;
  }

  const winner = p1Won ? p1 : p2;
  const loser = p1Won ? p2 : p1;

  if (p1Won) {
    game.p1Marbles++;
    game.p2Marbles--;
  } else {
    game.p2Marbles++;
    game.p1Marbles--;
  }

  game.roundHistory.push({ round: game.round, drawn: drawnNumber, winner: winner.displayName });

  const resultEmbed = new EmbedBuilder()
    .setTitle(`🎯 Round ${game.round} — Result`)
    .setDescription(
      `The draw landed on **${drawnNumber}**!${missedLog}\n\n` +
      `**${winner.displayName}** guessed it and steals a marble from **${loser.displayName}**! 🪙`
    )
    .addFields(buildDuelScoreField(game), buildDuelGuessField(game, guesses))
    .setColor(p1Won ? 0xA855F7 : 0x22D3EE)
    .setTimestamp();

  if (game.gameMessage) await game.gameMessage.edit({ embeds: [resultEmbed], components: [] });

  const isOver = game.p1Marbles <= 0 || game.p2Marbles <= 0 || game.p1Marbles >= 10 || game.p2Marbles >= 10;
  if (isOver) {
    setTimeout(() => endDuelGame(gameId), 4000);
  } else {
    setTimeout(() => nextDuelRound(gameId), 5000);
  }
}

function buildDuelScoreField(game) {
  const [p1, p2] = game.players;
  return {
    name: '📊 Marble Count',
    value: `⚔️ **${p1.displayName}**: ${marbleBar(game.p1Marbles)}\n🎯 **${p2.displayName}**: ${marbleBar(game.p2Marbles)}`,
    inline: false
  };
}

function buildDuelGuessField(game, guesses) {
  const [p1, p2] = game.players;
  const lines = [p1, p2].map(p => {
    const g = guesses[p.id];
    return `<@${p.id}> → **${g !== undefined ? g : '?'}**`;
  });
  return { name: '🔢 Guesses This Round', value: lines.join('\n'), inline: false };
}

async function nextDuelRound(gameId) {
  const game = global.activeDuelGames[gameId];
  if (!game) return;

  game.round++;
  game.playerGuesses = {};
  game.votedCount = 0;

  const coinFlip = Math.random() < 0.5 ? 'heads' : 'tails';
  game.currentPlayerIndex = coinFlip === 'heads' ? 0 : 1;
  game.firstPlayerIndex = game.currentPlayerIndex;

  const embed = createDuelGameEmbed(game, coinFlip);
  const pickButton = createDuelPickButton(gameId);
  await refreshDuelMessage(game, [embed], [pickButton]);
}

async function endDuelGame(gameId) {
  const game = global.activeDuelGames[gameId];
  if (!game) return;

  const [p1, p2] = game.players;
  const p1Won = game.p1Marbles >= 10 || game.p2Marbles <= 0;
  const winner = p1Won ? p1 : p2;
  const loser = p1Won ? p2 : p1;
  const winnerMarbles = p1Won ? game.p1Marbles : game.p2Marbles;
  const loserMarbles = p1Won ? game.p2Marbles : game.p1Marbles;

  // Award full pot to winner
  await getUser(winner.id);
  userData[winner.id].cash += game.totalPot;
  await saveUserData();

  const duration = Math.max(1, Math.round((Date.now() - game.createdAt) / 60000));

  const gameEndEmbed = new EmbedBuilder()
    .setTitle(`🏆 ${winner.displayName} Wins the Duel!`)
    .setDescription(
      `After **${game.round} rounds**, **${winner.displayName}** drained **${loser.displayName}**'s marbles!\n\n` +
      `🏅 **Winner:** <@${winner.id}> — **$${game.totalPot.toLocaleString()}** claimed!\n` +
      `💀 **Defeated:** <@${loser.id}>`
    )
    .addFields(
      {
        name: '📊 Final Marble Count',
        value: `${winner.displayName}: ${marbleBar(winnerMarbles)}\n${loser.displayName}: ${marbleBar(loserMarbles)}`,
        inline: false
      },
      {
        name: '💰 Prize',
        value: `**$${game.totalPot.toLocaleString()}** (pot of $${game.betAmount.toLocaleString()} × 2)`,
        inline: true
      },
      {
        name: '📈 Stats',
        value: `Rounds: **${game.round}** • Duration: **${duration} min**`,
        inline: true
      }
    )
    .setColor(0xFFD700)
    .setFooter({ text: 'Winnings distributed! Thanks for dueling.' })
    .setTimestamp();

  await refreshDuelMessage(game, [gameEndEmbed], []);
  delete global.activeDuelGames[gameId];
}

async function refreshDuelMessage(game, embeds, components) {
  if (game.gameMessage) {
    try { await game.gameMessage.delete(); } catch (_) {}
    game.gameMessage = null;
  }
  if (game.channel) {
    game.gameMessage = await game.channel.send({ embeds, components: components ?? [] });
  }
}

// === MASS SELL SYSTEM ===


// === XP CONVERSION SYSTEM ===

async function handleConvertCommand(interaction, userId) {
  // Initialize user XP data if needed
  if (!userData[userId].xpData) {
    userData[userId].xpData = { xp: 0, messageCount: 0, lastMessage: 0 };
  }

  const userXpData = userData[userId].xpData;

  if (userXpData.xp === 0) {
    const noXpEmbed = new EmbedBuilder()
      .setTitle('No XP Available')
      .setDescription('You don\'t have any XP to convert yet.')
      .addFields(
        { name: 'Current XP', value: '0 XP', inline: true },
        { name: 'How to Earn XP', value: 'Participate in conversations! You earn 1 XP for every 2 messages sent during active conversations.', inline: false },
        { name: 'Anti-Spam Protection', value: 'XP is only awarded when you\'re actively conversing with other users in the same channel.', inline: false }
      )
      .setColor(0xFF9F43)
      .setTimestamp();

    return await interaction.reply({ embeds: [noXpEmbed] });
  }

  const cashValue = userXpData.xp * 2;

  const convertEmbed = new EmbedBuilder()
    .setTitle('XP Conversion Available')
    .setDescription('Would you like to convert your XP into cash?')
    .addFields(
      { name: 'Available XP', value: `${userXpData.xp.toLocaleString()} XP`, inline: true },
      { name: 'Conversion Rate', value: '1 XP = $2', inline: true },
      { name: 'Cash Value', value: `$${cashValue.toLocaleString()}`, inline: true },
      { name: 'Current Cash', value: `$${userData[userId].cash.toLocaleString()}`, inline: true },
      { name: 'Cash After Conversion', value: `$${(userData[userId].cash + cashValue).toLocaleString()}`, inline: true },
      { name: 'Note', value: 'Converted cash goes directly to your wallet (not bank)', inline: false }
    )
    .setColor(0x5865F2)
    .setFooter({ text: 'This action cannot be undone' })
    .setTimestamp();

  const acceptButton = new ButtonBuilder()
    .setCustomId(`convert_accept_${userId}`)
    .setLabel('Accept Conversion')
    .setStyle(ButtonStyle.Success);

  const declineButton = new ButtonBuilder()
    .setCustomId(`convert_decline_${userId}`)
    .setLabel('Keep XP')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(acceptButton, declineButton);

  await interaction.reply({ embeds: [convertEmbed], components: [row] });
}

async function handleMiningStatusCommand(interaction) {
  await checkAndHandleEvents(); // Ensure events are up to date

  const eventData = await getEventSystem();
  const event = eventData.currentEvent;
  const nextEventTime = eventData.nextEventTime;
  const now = Date.now();

  if (event) {
    // Active event
    const timeLeft = event.endTime - now;
    const hoursLeft = Math.floor(timeLeft / (60 * 60 * 1000));
    const minutesLeft = Math.floor((timeLeft % (60 * 60 * 1000)) / (60 * 1000));

    const eventEmbed = new EmbedBuilder()
      .setTitle('ACTIVE MINING EVENT')
      .setDescription('**A mining crisis is currently affecting exploration operations!**')
      .addFields(
        { 
          name: 'Collapsed Mine', 
          value: `**${event.negativeArtefact}** mine is currently **CLOSED** due to structural collapse`, 
          inline: false 
        },
        { 
          name: 'Expanded Mine', 
          value: `**${event.positiveArtefact}** mine has **DOUBLED** discovery rates due to geological expansion`, 
          inline: false 
        },
        { 
          name: 'Time Remaining', 
          value: `**${hoursLeft}h ${minutesLeft}m** until mines return to normal`, 
          inline: true 
        },
        { 
          name: 'Scavenging Impact', 
          value: `• **${event.negativeArtefact}**: Cannot be found\n• **${event.positiveArtefact}**: 2x discovery chance\n• All other artefacts: Normal rates`, 
          inline: false 
        }
      )
      .setColor(0xFF4500)
      .setFooter({ text: 'Take advantage of the expanded mine while you can!' })
      .setTimestamp();

    await interaction.reply({ embeds: [eventEmbed] });

  } else {
    // No active event
    const timeUntilNext = nextEventTime - now;
    const daysUntilNext = Math.floor(timeUntilNext / (24 * 60 * 60 * 1000));
    const hoursUntilNext = Math.floor((timeUntilNext % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

    const statusEmbed = new EmbedBuilder()
      .setTitle('MINING OPERATIONS STATUS')
      .setDescription('**All mining sectors are operating under normal conditions**')
      .addFields(
        { 
          name: 'Mine Status', 
          value: 'All artefact mines are **OPERATIONAL** and accessible for exploration', 
          inline: false 
        },
        { 
          name: 'Discovery Rates', 
          value: 'Standard scavenging probabilities are in effect across all sectors', 
          inline: false 
        },
        { 
          name: 'Next Event', 
          value: `Expected mining event in **${daysUntilNext}d ${hoursUntilNext}h**`, 
          inline: true 
        },
        { 
          name: 'Current Scavenging', 
          value: 'All artefacts available at normal discovery rates', 
          inline: false 
        }
      )
      .setColor(0x00FF7F)
      .setFooter({ text: 'Fortune Bot Mining Authority • Real-time status monitoring' })
      .setTimestamp();

    await interaction.reply({ embeds: [statusEmbed] });
  }
}

// === DEVELOPER COMMAND HANDLERS ===

function buildGiveArtefactEmbed(session) {
  const queueText = session.queue.length
    ? session.queue.map(e => {
        const rarity = getRarityByArtefact(e.name);
        const tier = getArtefactTier(e.name);
        const tierSell = calcArtefactSellValue(e.name, rarity);
        return `${e.name} x${e.amount} — ${rarity ? rarity.name : 'Unknown'} T${tier} ($${(tierSell * e.amount).toLocaleString()} total)`;
      }).join('\n')
    : 'Nothing queued yet — select an artefact and add it below.';

  const totalItems = session.queue.reduce((s, e) => s + e.amount, 0);

  return new EmbedBuilder()
    .setTitle(`Give Artefacts to ${session.targetDisplayName}`)
    .setDescription('Select an artefact from the dropdown, then use the buttons to queue it. Confirm when your list is ready.')
    .addFields(
      { name: 'Currently Selected', value: session.selectedArtefact || 'None — pick from the dropdown below', inline: false },
      { name: `Queue (${totalItems} artefact${totalItems !== 1 ? 's' : ''})`, value: queueText, inline: false }
    )
    .setColor(session.queue.length > 0 ? 0x51CF66 : 0x339AF0)
    .setFooter({ text: 'Session expires in 5 minutes' })
    .setTimestamp();
}

function buildGiveArtefactComponents(sessionId, session) {
  const allArtefacts = rarities.flatMap(r => r.items.map(item => ({ item, rarity: r })));
  const selectOptions = allArtefacts.slice(0, 25).map(({ item, rarity }) => {
    const tier = getArtefactTier(item);
    const tierSell = calcArtefactSellValue(item, rarity);
    return {
      label: item,
      description: `${rarity.name} T${tier} — $${tierSell.toLocaleString()} sell value`,
      value: item,
      default: session.selectedArtefact === item
    };
  });

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`ga_select_${sessionId}`)
      .setPlaceholder('Select an artefact to queue')
      .addOptions(selectOptions)
  );

  const hasSelection = !!session.selectedArtefact;
  const hasQueue = session.queue.length > 0;
  const totalItems = session.queue.reduce((s, e) => s + e.amount, 0);

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ga_add_one_${sessionId}`)
      .setLabel('Add x1')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!hasSelection),
    new ButtonBuilder()
      .setCustomId(`ga_add_custom_${sessionId}`)
      .setLabel('Add Custom Amount')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasSelection),
    new ButtonBuilder()
      .setCustomId(`ga_clear_queue_${sessionId}`)
      .setLabel('Clear Queue')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasQueue),
    new ButtonBuilder()
      .setCustomId(`ga_confirm_${sessionId}`)
      .setLabel(`Confirm Give (${totalItems})`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(!hasQueue),
    new ButtonBuilder()
      .setCustomId(`ga_cancel_${sessionId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger)
  );

  return [selectRow, buttonRow];
}

async function handleGiveArtefactCommand(interaction) {
  if (!isDeveloper(interaction.user.id)) {
    return await interaction.reply({
      embeds: [new EmbedBuilder().setTitle('Access Denied').setDescription('This command is restricted to developers only.').setColor(0xFF6B6B).setTimestamp()],
      ephemeral: true
    });
  }

  const targetUser = interaction.options.getUser('user');
  const targetId = targetUser.id;

  await getUser(targetId);

  const sessionId = `${interaction.user.id}_${Date.now()}`;
  const session = {
    userId: interaction.user.id,
    targetId,
    targetDisplayName: targetUser.displayName,
    selectedArtefact: null,
    queue: [],
    message: null
  };

  global.giveArtefactSessions[sessionId] = session;

  const reply = await interaction.reply({
    embeds: [buildGiveArtefactEmbed(session)],
    components: buildGiveArtefactComponents(sessionId, session),
    fetchReply: true
  });

  session.message = reply;

  const collector = reply.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id,
    time: 300000
  });

  collector.on('collect', async i => {
    if (i.customId === `ga_select_${sessionId}`) {
      session.selectedArtefact = i.values[0];
      await i.update({ embeds: [buildGiveArtefactEmbed(session)], components: buildGiveArtefactComponents(sessionId, session) });

    } else if (i.customId === `ga_add_one_${sessionId}`) {
      const existing = session.queue.find(e => e.name === session.selectedArtefact);
      if (existing) {
        existing.amount++;
      } else {
        session.queue.push({ name: session.selectedArtefact, amount: 1 });
      }
      await i.update({ embeds: [buildGiveArtefactEmbed(session)], components: buildGiveArtefactComponents(sessionId, session) });

    } else if (i.customId === `ga_add_custom_${sessionId}`) {
      const modal = new ModalBuilder()
        .setCustomId(`ga_amount_modal_${sessionId}`)
        .setTitle(`Amount for ${session.selectedArtefact}`)
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('ga_amount_input')
              .setLabel(`How many ${session.selectedArtefact} to give?`)
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Enter a number (1–1000)')
              .setMinLength(1)
              .setMaxLength(4)
              .setRequired(true)
          )
        );
      await i.showModal(modal);

    } else if (i.customId === `ga_clear_queue_${sessionId}`) {
      session.queue = [];
      await i.update({ embeds: [buildGiveArtefactEmbed(session)], components: buildGiveArtefactComponents(sessionId, session) });

    } else if (i.customId === `ga_confirm_${sessionId}`) {
      const target = await getUser(targetId);
      let totalGiven = 0;
      const summaryLines = [];

      for (const entry of session.queue) {
        for (let j = 0; j < entry.amount; j++) {
          target.artefacts.push(entry.name);
        }
        totalGiven += entry.amount;
        const rarity = getRarityByArtefact(entry.name);
        summaryLines.push(`${entry.name} x${entry.amount} (${rarity ? rarity.name : 'Unknown'})`);
      }

      await saveUser(targetId);
      collector.stop('confirmed');
      delete global.giveArtefactSessions[sessionId];

      const successEmbed = new EmbedBuilder()
        .setTitle('Artefacts Given')
        .setDescription(`Successfully gave **${totalGiven}** artefact(s) to <@${targetId}>!`)
        .addFields(
          { name: 'Items Given', value: summaryLines.join('\n'), inline: false },
          { name: 'Recipient', value: `<@${targetId}>`, inline: true },
          { name: 'Given By', value: `<@${interaction.user.id}>`, inline: true }
        )
        .setColor(0x51CF66)
        .setFooter({ text: 'Developer Command Executed' })
        .setTimestamp();

      await i.update({ embeds: [successEmbed], components: [] });

    } else if (i.customId === `ga_cancel_${sessionId}`) {
      collector.stop('cancelled');
      delete global.giveArtefactSessions[sessionId];
      await i.update({
        embeds: [new EmbedBuilder().setTitle('Cancelled').setDescription('No artefacts were given.').setColor(0xFF6B6B).setTimestamp()],
        components: []
      });
    }
  });

  collector.on('end', async (collected, reason) => {
    if (reason === 'time') {
      delete global.giveArtefactSessions[sessionId];
      try {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setTitle('Session Expired').setDescription('No artefacts were given.').setColor(0xFF9F43).setTimestamp()],
          components: []
        });
      } catch (e) {}
    }
  });
}

async function handleGiveCashCommand(interaction) {
  // Check developer permissions
  if (!isDeveloper(interaction.user.id)) {
    const accessDeniedEmbed = new EmbedBuilder()
      .setTitle('Access Denied')
      .setDescription('This command is restricted to developers only.')
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.reply({ embeds: [accessDeniedEmbed], ephemeral: true });
  }

  const targetUser = interaction.options.getUser('user');
  const amount = interaction.options.getInteger('amount');
  const targetId = targetUser.id;

  // Initialize target user if needed
  if (!userData[targetId]) userData[targetId] = { cash: 0, artefacts: [], bankBalance: 0 };

  // Give cash to user
  userData[targetId].cash += amount;
  await saveUserData();

  const successEmbed = new EmbedBuilder()
    .setTitle('Cash Given')
    .setDescription(`Successfully gave **$${amount.toLocaleString()}** to ${targetUser.displayName}!`)
    .addFields(
      { name: 'Recipient', value: `<@${targetId}>`, inline: true },
      { name: 'Amount Given', value: `$${amount.toLocaleString()}`, inline: true },
      { name: 'New Cash Total', value: `$${userData[targetId].cash.toLocaleString()}`, inline: true },
      { name: 'Developer', value: `<@${interaction.user.id}>`, inline: true }
    )
    .setColor(0x00FF7F)
    .setFooter({ text: 'Developer Command Executed' })
    .setTimestamp();

  await interaction.reply({ embeds: [successEmbed] });
}

async function handleSetEventCommand(interaction) {
  // Check developer permissions
  if (!isDeveloper(interaction.user.id)) {
    const accessDeniedEmbed = new EmbedBuilder()
      .setTitle('Access Denied')
      .setDescription('This command is restricted to developers only.')
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.reply({ embeds: [accessDeniedEmbed], ephemeral: true });
  }

  const positiveArtefact = interaction.options.getString('positive_artefact');
  const negativeArtefact = interaction.options.getString('negative_artefact');

  // Validate artefacts exist
  const positiveRarity = getRarityByArtefact(positiveArtefact);
  const negativeRarity = getRarityByArtefact(negativeArtefact);

  if (!positiveRarity || !negativeRarity) {
    const invalidEmbed = new EmbedBuilder()
      .setTitle('Invalid Artefact Names')
      .setDescription('One or both artefact names are invalid.')
      .addFields({
        name: 'Valid Artefacts',
        value: rarities.map(r => r.items.join(', ')).join('\n'),
        inline: false
      })
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.reply({ embeds: [invalidEmbed], ephemeral: true });
  }

  if (positiveArtefact === negativeArtefact) {
    const sameArtefactEmbed = new EmbedBuilder()
      .setTitle('Invalid Event Configuration')
      .setDescription('Positive and negative artefacts must be different.')
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.reply({ embeds: [sameArtefactEmbed], ephemeral: true });
  }

  // End current event if one is active
  const eventData = await getEventSystem();
  if (eventData && eventData.currentEvent) {
    await endCurrentEvent();
  }

  // Create new event
  const now = Date.now();
  const newEvent = {
    id: `dev_event_${now}`,
    startTime: now,
    endTime: now + (24 * 60 * 60 * 1000), // 24 hours
    negativeArtefact,
    positiveArtefact,
    type: 'developer_triggered'
  };

  const updatedEventData = {
    currentEvent: newEvent,
    lastEventStart: now,
    nextEventTime: now + (4 * 24 * 60 * 60 * 1000), // Next event in 4 days
    eventHistory: [newEvent, ...(eventData?.eventHistory || [])].slice(0, 10)
  };

  await saveEventSystem(updatedEventData);

  const eventEmbed = new EmbedBuilder()
    .setTitle('Developer Event Triggered')
    .setDescription(`**Mining event manually initiated by ${interaction.user.displayName}!**`)
    .addFields(
      { 
        name: 'Mine Collapse', 
        value: `**${negativeArtefact}** mine has been forcibly closed`, 
        inline: false 
      },
      { 
        name: 'Mine Expansion', 
        value: `**${positiveArtefact}** mine has been expanded (2x discovery rate)`, 
        inline: false 
      },
      { 
        name: 'Event Duration', 
        value: '24 hours', 
        inline: true 
      },
      { 
        name: 'Effect', 
        value: `• **${negativeArtefact}**: Cannot be found\n• **${positiveArtefact}**: 2x discovery chance`, 
        inline: false 
      },
      { 
        name: 'Developer', 
        value: `<@${interaction.user.id}>`, 
        inline: true 
      }
    )
    .setColor(0x9932CC)
    .setFooter({ text: 'Developer Command Executed • Event Active for 24 hours' })
    .setTimestamp();

  await interaction.reply({ embeds: [eventEmbed] });

  // Broadcast the event start
  await broadcastEventStart(newEvent);
}

async function handleRemoveArtefactCommand(interaction) {
  // Check developer permissions
  if (!isDeveloper(interaction.user.id)) {
    const accessDeniedEmbed = new EmbedBuilder()
      .setTitle('Access Denied')
      .setDescription('This command is restricted to developers only.')
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.reply({ embeds: [accessDeniedEmbed], ephemeral: true });
  }

  const targetUser = interaction.options.getUser('user');
  const artefactName = interaction.options.getString('artefact');
  const targetId = targetUser.id;

  // Initialize target user if needed
  if (!userData[targetId]) userData[targetId] = { cash: 0, artefacts: [], bankBalance: 0 };

  // Check if user has the artefact
  const artefactIndex = userData[targetId].artefacts.findIndex(item => item === artefactName);
  if (artefactIndex === -1) {
    const notFoundEmbed = new EmbedBuilder()
      .setTitle('Artefact Not Found')
      .setDescription(`${targetUser.displayName} does not have an artefact named "${artefactName}".`)
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.reply({ embeds: [notFoundEmbed], ephemeral: true });
  }

  const rarity = getRarityByArtefact(artefactName);

  // Remove artefact from user
  userData[targetId].artefacts.splice(artefactIndex, 1);
  await saveUserData();

  const successEmbed = new EmbedBuilder()
    .setTitle('Artefact Removed')
    .setDescription(`Successfully removed **${artefactName}** from ${targetUser.displayName}!`)
    .addFields(
      { name: 'Target User', value: `<@${targetId}>`, inline: true },
      { name: 'Artefact', value: artefactName, inline: true },
      { name: 'Rarity', value: rarity ? rarity.name : 'Unknown', inline: true },
      { name: 'Tier', value: `T${getArtefactTier(artefactName)}`, inline: true },
      { name: 'Value', value: rarity ? `$${calcArtefactSellValue(artefactName, rarity).toLocaleString()}` : 'Unknown', inline: true },
      { name: 'Developer', value: `<@${interaction.user.id}>`, inline: true }
    )
    .setColor(0xFF6B6B)
    .setFooter({ text: 'Developer Command Executed' })
    .setTimestamp();

  await interaction.reply({ embeds: [successEmbed] });
}

async function handleRemoveCashCommand(interaction) {
  // Check developer permissions
  if (!isDeveloper(interaction.user.id)) {
    const accessDeniedEmbed = new EmbedBuilder()
      .setTitle('Access Denied')
      .setDescription('This command is restricted to developers only.')
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.reply({ embeds: [accessDeniedEmbed], ephemeral: true });
  }

  const targetUser = interaction.options.getUser('user');
  const amount = interaction.options.getInteger('amount');
  const targetId = targetUser.id;

  // Initialize target user if needed
  if (!userData[targetId]) userData[targetId] = { cash: 0, artefacts: [], bankBalance: 0 };

  const totalWealth = userData[targetId].cash + (userData[targetId].bankBalance || 0);

  // Check if user has enough total money (cash + bank)
  if (totalWealth < amount) {
    const insufficientEmbed = new EmbedBuilder()
      .setTitle('Insufficient Funds')
      .setDescription(`${targetUser.displayName} only has $${totalWealth.toLocaleString()} total wealth, cannot remove $${amount.toLocaleString()}.`)
      .addFields(
        { name: 'Available Cash', value: `$${userData[targetId].cash.toLocaleString()}`, inline: true },
        { name: 'Bank Balance', value: `$${(userData[targetId].bankBalance || 0).toLocaleString()}`, inline: true },
        { name: 'Total Wealth', value: `$${totalWealth.toLocaleString()}`, inline: true }
      )
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.reply({ embeds: [insufficientEmbed], ephemeral: true });
  }

  let remainingToRemove = amount;
  let removedFromCash = 0;
  let removedFromBank = 0;

  // First, remove from cash
  if (userData[targetId].cash > 0) {
    removedFromCash = Math.min(userData[targetId].cash, remainingToRemove);
    userData[targetId].cash -= removedFromCash;
    remainingToRemove -= removedFromCash;
  }

  // Then, remove remaining from bank if needed
  if (remainingToRemove > 0 && userData[targetId].bankBalance > 0) {
    removedFromBank = Math.min(userData[targetId].bankBalance, remainingToRemove);
    userData[targetId].bankBalance -= removedFromBank;
    remainingToRemove -= removedFromBank;
  }

  await saveUserData();

  const successEmbed = new EmbedBuilder()
    .setTitle('Cash Removed (Bypassed Bank)')
    .setDescription(`Successfully removed **$${amount.toLocaleString()}** from ${targetUser.displayName}!`)
    .addFields(
      { name: 'Target User', value: `<@${targetId}>`, inline: true },
      { name: 'Amount Removed', value: `$${amount.toLocaleString()}`, inline: true },
      { name: 'Removed from Cash', value: `$${removedFromCash.toLocaleString()}`, inline: true },
      { name: 'Removed from Bank', value: `$${removedFromBank.toLocaleString()}`, inline: true },
      { name: 'New Cash Total', value: `$${userData[targetId].cash.toLocaleString()}`, inline: true },
      { name: 'New Bank Balance', value: `$${(userData[targetId].bankBalance || 0).toLocaleString()}`, inline: true },
      { name: 'Developer', value: `<@${interaction.user.id}>`, inline: false }
    )
    .setColor(0xFF6B6B)
    .setFooter({ text: 'Developer Command Executed • Bank Protection Bypassed' })
    .setTimestamp();

  await interaction.reply({ embeds: [successEmbed] });
}

async function handleResetCooldownsCommand(interaction) {
  // Check developer permissions
  if (!isDeveloper(interaction.user.id)) {
    const accessDeniedEmbed = new EmbedBuilder()
      .setTitle('Access Denied')
      .setDescription('This command is restricted to developers only.')
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.editReply({ embeds: [accessDeniedEmbed] });
  }

  const targetUser = interaction.options.getUser('user');

  if (targetUser) {
    // Reset cooldowns for specific user
    const userId = targetUser.id;

    // Clear all cooldowns for this user (safe deletion from objects)
    if (cooldowns.scavenge && cooldowns.scavenge[userId]) delete cooldowns.scavenge[userId];
    if (cooldowns.labor && cooldowns.labor[userId]) delete cooldowns.labor[userId];
    if (cooldowns.steal && cooldowns.steal[userId]) delete cooldowns.steal[userId];

    await saveCooldowns();

    const successEmbed = new EmbedBuilder()
      .setTitle('Cooldowns Reset')
      .setDescription(`Successfully reset all cooldowns for ${targetUser.displayName}!`)
      .addFields(
        { name: 'Target User', value: `<@${userId}>`, inline: true },
        { name: 'Cooldowns Reset', value: 'Scavenge, Labor, Steal', inline: true },
        { name: 'Developer', value: `<@${interaction.user.id}>`, inline: true }
      )
      .setColor(0x51CF66)
      .setFooter({ text: 'Developer Command Executed' })
      .setTimestamp();

    await interaction.editReply({ embeds: [successEmbed] });
  } else {
    // Reset cooldowns for ALL users globally
    cooldowns.scavenge = {};
    cooldowns.labor = {};
    cooldowns.steal = {};

    await saveCooldowns();

    const successEmbed = new EmbedBuilder()
      .setTitle('Global Cooldown Reset')
      .setDescription('Successfully reset ALL cooldowns for ALL users globally!')
      .addFields(
        { name: 'Scope', value: 'All Users Worldwide', inline: true },
        { name: 'Cooldowns Reset', value: 'Scavenge, Labor, Steal', inline: true },
        { name: 'Developer', value: `<@${interaction.user.id}>`, inline: true }
      )
      .setColor(0x51CF66)
      .setFooter({ text: 'Developer Command Executed' })
      .setTimestamp();

    await interaction.editReply({ embeds: [successEmbed] });
  }
}

async function handleConfigureObservationCommand(interaction, userId) {
  const user = await getUser(userId);
  const current = user.observationPermission || 'prohibit';

  function buildConfigEmbed(setting) {
    const isAllow = setting === 'allow';
    return new EmbedBuilder()
      .setTitle('Observation Permissions')
      .setDescription(
        'Control whether other players can view your inventory, artefacts, stats and activity using `/observe`.\n\n' +
        'Your current setting is shown below. Click a button to change it.'
      )
      .addFields(
        {
          name: 'Current Setting',
          value: isAllow
            ? 'Allow — Anyone may view your profile with /observe.'
            : 'Prohibit — Your profile is hidden from /observe.',
          inline: false
        },
        {
          name: 'What "Allow" exposes',
          value: [
            'Cash on hand and bank balance',
            'Full artefact collection with rarity, tier, and value',
            'Purchased items',
            'XP, message count, and command count',
            'Date you started playing'
          ].join('\n'),
          inline: false
        }
      )
      .setColor(isAllow ? 0x51CF66 : 0xFF6B6B)
      .setFooter({ text: 'Changes are saved immediately when you click a button.' })
      .setTimestamp();
  }

  function buildConfigComponents(setting) {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('obs_cfg_allow')
        .setLabel('Allow Observation')
        .setStyle(setting === 'allow' ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(setting === 'allow'),
      new ButtonBuilder()
        .setCustomId('obs_cfg_prohibit')
        .setLabel('Prohibit Observation')
        .setStyle(setting === 'prohibit' ? ButtonStyle.Danger : ButtonStyle.Secondary)
        .setDisabled(setting === 'prohibit')
    )];
  }

  const reply = await interaction.reply({
    embeds: [buildConfigEmbed(current)],
    components: buildConfigComponents(current),
    ephemeral: true,
    fetchReply: true
  });

  const collector = reply.createMessageComponentCollector({
    filter: i => i.user.id === userId,
    time: 120000
  });

  collector.on('collect', async i => {
    const newSetting = i.customId === 'obs_cfg_allow' ? 'allow' : 'prohibit';
    userData[userId].observationPermission = newSetting;
    await saveUser(userId);
    await i.update({
      embeds: [buildConfigEmbed(newSetting)],
      components: buildConfigComponents(newSetting)
    });
  });

  collector.on('end', async () => {
    try {
      await interaction.editReply({ components: [] });
    } catch (e) {}
  });
}

function buildProgressBar(current, total) {
  if (total === 0) return '[░░░░░░░░░░]';
  const filled = Math.round((current / total) * 10);
  const empty = 10 - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

function buildCollectionPage(user, pageIndex) {
  const rarity = rarities[pageIndex];
  const items = rarity.items;

  if (!user.discoveredArtefacts) user.discoveredArtefacts = [];

  const discovered = new Set([
    ...user.discoveredArtefacts,
    ...(user.artefacts || []).map(a =>
      a.startsWith('✨ SHINY ') && a.endsWith(' ✨')
        ? a.replace('✨ SHINY ', '').replace(' ✨', '')
        : a
    )
  ]);

  const inventoryCounts = {};
  for (const a of (user.artefacts || [])) {
    const base = a.startsWith('✨ SHINY ') && a.endsWith(' ✨')
      ? a.replace('✨ SHINY ', '').replace(' ✨', '')
      : a;
    inventoryCounts[base] = (inventoryCounts[base] || 0) + 1;
  }

  const byTier = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const item of items) {
    const tier = artefactTiers[item] || 3;
    byTier[tier].push(item);
  }

  const collectedCount = items.filter(i => discovered.has(i)).length;
  const totalCount = items.length;
  const progressBar = buildProgressBar(collectedCount, totalCount);

  const rarityEmoji = { Common: '⬜', Uncommon: '🟩', Rare: '🟦', Legendary: '🟨', Unknown: '⬛' };
  const tierLabel = { 1: 'Tier I  ·  ×0.65 value', 2: 'Tier II  ·  ×0.75 value', 3: 'Tier III  ·  ×1.0 value', 4: 'Tier IV  ·  ×1.25 value', 5: 'Tier V  ·  ×1.35 value' };

  const fields = [];
  for (const tier of [1, 2, 3, 4, 5]) {
    const tierItems = byTier[tier];
    if (!tierItems || tierItems.length === 0) continue;

    const lines = tierItems.map(item => {
      const isFound = discovered.has(item);
      const count = inventoryCounts[item] || 0;
      const sellValue = calcArtefactSellValue(item, rarity).toLocaleString();
      const countStr = count > 0 ? `  *(×${count} in vault)*` : '';
      const icon = isFound ? '✅' : '❌';
      const nameStr = isFound ? `**${item}**` : `~~${item}~~`;
      return `${icon}  ${nameStr}  ·  $${sellValue}${countStr}`;
    });

    fields.push({
      name: `▬▬▬  ${tierLabel[tier]}  ▬▬▬`,
      value: lines.join('\n'),
      inline: false
    });
  }

  const embedColor = rarity.color === 0x000000 ? 0x2B2D31 : rarity.color;

  return new EmbedBuilder()
    .setTitle(`${rarityEmoji[rarity.name] || '📋'}  Field Guide — ${rarity.name}`)
    .setDescription(
      `**${collectedCount} / ${totalCount} discovered**  ${progressBar}\n` +
      `*Drop chance: ${rarity.chance}%  ·  Base sell value: $${rarity.sell.toLocaleString()}*`
    )
    .setColor(embedColor)
    .addFields(fields)
    .setFooter({ text: `Page ${pageIndex + 1} / ${rarities.length}  ·  ✅ Discovered  ·  ❌ Not yet found` })
    .setTimestamp();
}

function buildCollectionButtons(userId, pageIndex) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`collection_prev_${userId}_${pageIndex}`)
      .setLabel('◀  Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageIndex === 0),
    new ButtonBuilder()
      .setCustomId(`collection_next_${userId}_${pageIndex}`)
      .setLabel('Next  ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageIndex === rarities.length - 1)
  );
  return [row];
}

async function handleCollectionCommand(interaction, userId) {
  const user = await getUser(userId);
  if (!user.discoveredArtefacts) user.discoveredArtefacts = [];

  const pageIndex = 0;
  const embed = buildCollectionPage(user, pageIndex);
  const components = buildCollectionButtons(userId, pageIndex);
  await interaction.reply({ embeds: [embed], components });
}

async function handleObserveCommand(interaction, observerId) {
  const targetDiscordUser = interaction.options.getUser('player');
  const targetId = targetDiscordUser.id;

  if (targetId === observerId) {
    return await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('Cannot Observe Yourself')
        .setDescription('Use `/inventory` to view your own stats and artefacts.')
        .setColor(0xFF9F43)
        .setTimestamp()
      ],
      ephemeral: true
    });
  }

  const target = await getUser(targetId);
  const permission = target.observationPermission || 'prohibit';

  if (permission !== 'allow') {
    return await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('Observation Denied')
        .setDescription(
          `The user you wish to observe has set their observation permissions to **Prohibit**.\n\n` +
          `If you would like to observe their inventory, ask them to give you access by running ` +
          `\`/configure-observation\` and selecting **Allow**.`
        )
        .addFields(
          { name: 'Requested Profile', value: `<@${targetId}>`, inline: true },
          { name: 'Permission Status', value: 'Prohibit', inline: true }
        )
        .setColor(0xFF6B6B)
        .setFooter({ text: 'Each player controls their own visibility settings.' })
        .setTimestamp()
      ]
    });
  }

  // Pull live data
  const bankCapacity = await calculateBankCapacity(targetId);
  const totalWealth = target.cash + (target.bankBalance || 0);

  const collectionValue = (target.artefacts || []).reduce((sum, name) => {
    const isShiny = name.startsWith('✨ SHINY ') && name.endsWith(' ✨');
    const rarity = getRarityByArtefact(name);
    const tierSell = calcArtefactSellValue(name, rarity);
    return sum + (isShiny ? tierSell * 20 : tierSell);
  }, 0);

  const xp = target.xpData?.xp || 0;
  const messages = target.xpData?.messageCount || 0;
  const commands = target.commandCount || 0;
  const joinedDate = target.joinedDate
    ? `<t:${Math.floor(target.joinedDate / 1000)}:D>`
    : 'Before records began';

  // Build artefact lines
  const artefactCounts = {};
  (target.artefacts || []).forEach(name => {
    artefactCounts[name] = (artefactCounts[name] || 0) + 1;
  });

  const artefactLines = Object.entries(artefactCounts).map(([name, count]) => {
    const rarity = getRarityByArtefact(name);
    const tier = getArtefactTier(name);
    const tierSell = calcArtefactSellValue(name, rarity);
    const isShiny = name.startsWith('✨ SHINY ') && name.endsWith(' ✨');
    const sellDisplay = isShiny ? tierSell * 20 : tierSell;
    const countSuffix = count > 1 ? ` [${count}]` : '';
    return `${name} (${rarity ? rarity.name : 'Unknown'} T${tier} — $${sellDisplay.toLocaleString()})${countSuffix}`;
  });

  // Items summary
  const itemCounts = {};
  (target.items || []).forEach(item => { itemCounts[item] = (itemCounts[item] || 0) + 1; });
  const itemsDisplay = Object.entries(itemCounts)
    .map(([name, count]) => `${name}${count > 1 ? ` [${count}]` : ''}`)
    .join(', ') || 'No items purchased';

  // Chunk artefacts across pages (15 per artefact page)
  const ARTS_PER_PAGE = 15;
  const artefactChunks = [];
  if (artefactLines.length === 0) {
    artefactChunks.push('No artefacts in inventory.');
  } else {
    for (let i = 0; i < artefactLines.length; i += ARTS_PER_PAGE) {
      artefactChunks.push(artefactLines.slice(i, i + ARTS_PER_PAGE).join('\n'));
    }
  }

  // Page layout: [0] Financial | [1..n] Artefacts | [last] Profile
  const totalPages = 2 + artefactChunks.length;
  let currentPage = 0;

  function buildPage(page) {
    const base = { color: 0x339AF0 };

    if (page === 0) {
      return new EmbedBuilder()
        .setTitle(`Observing ${targetDiscordUser.displayName}`)
        .setDescription(`Financial overview for <@${targetId}>`)
        .addFields(
          { name: 'Cash on Hand',      value: `$${target.cash.toLocaleString()}`,                inline: true },
          { name: 'Bank Balance',       value: `$${(target.bankBalance || 0).toLocaleString()}`,  inline: true },
          { name: 'Total Wealth',       value: `$${totalWealth.toLocaleString()}`,                inline: true },
          { name: 'Collection Value',   value: `$${collectionValue.toLocaleString()}`,            inline: true },
          { name: 'Bank Capacity',      value: `$${bankCapacity.toLocaleString()}`,               inline: true },
          { name: 'Bank Expansions',    value: `${target.bankExpansions || 0}`,                   inline: true },
          { name: 'Artefacts Owned',    value: `${(target.artefacts || []).length}`,              inline: true },
          { name: 'Purchased Items',    value: `${(target.items || []).length}`,                  inline: true },
          { name: 'Items',              value: itemsDisplay.length > 500 ? itemsDisplay.slice(0, 497) + '...' : itemsDisplay, inline: false }
        )
        .setColor(0x339AF0)
        .setFooter({ text: `Page 1 of ${totalPages} — Financial Overview` })
        .setTimestamp();

    } else if (page === totalPages - 1) {
      return new EmbedBuilder()
        .setTitle(`Observing ${targetDiscordUser.displayName}`)
        .setDescription(`Player profile for <@${targetId}>`)
        .addFields(
          { name: 'Experience Points', value: `${xp.toLocaleString()} XP`,          inline: true },
          { name: 'XP Cash Value',     value: `$${(xp * 2).toLocaleString()}`,       inline: true },
          { name: '\u200B',            value: '\u200B',                               inline: true },
          { name: 'Messages Sent',     value: messages.toLocaleString(),             inline: true },
          { name: 'Commands Used',     value: commands.toLocaleString(),             inline: true },
          { name: '\u200B',            value: '\u200B',                               inline: true },
          { name: 'Playing Since',     value: joinedDate,                            inline: false }
        )
        .setColor(0xFFD700)
        .setFooter({ text: `Page ${totalPages} of ${totalPages} — Player Profile` })
        .setTimestamp();

    } else {
      const chunkIndex = page - 1;
      const label = artefactChunks.length > 1
        ? `Artefacts (${chunkIndex + 1} of ${artefactChunks.length})`
        : 'Artefacts';
      return new EmbedBuilder()
        .setTitle(`Observing ${targetDiscordUser.displayName}`)
        .setDescription(
          `<@${targetId}> holds **${(target.artefacts || []).length}** artefact(s) ` +
          `valued at **$${collectionValue.toLocaleString()}** total.`
        )
        .addFields({ name: label, value: artefactChunks[chunkIndex], inline: false })
        .setColor(0x9B59B6)
        .setFooter({ text: `Page ${page + 1} of ${totalPages} — Artefact Collection` })
        .setTimestamp();
    }
  }

  function buildNavComponents(page) {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('obs_prev')
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId('obs_next')
        .setLabel('Next')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === totalPages - 1)
    )];
  }

  const reply = await interaction.reply({
    embeds: [buildPage(0)],
    components: buildNavComponents(0),
    fetchReply: true
  });

  const collector = reply.createMessageComponentCollector({
    filter: i => i.user.id === observerId,
    time: 300000
  });

  collector.on('collect', async i => {
    if (i.customId === 'obs_prev') currentPage = Math.max(0, currentPage - 1);
    if (i.customId === 'obs_next') currentPage = Math.min(totalPages - 1, currentPage + 1);
    await i.update({ embeds: [buildPage(currentPage)], components: buildNavComponents(currentPage) });
  });

  collector.on('end', async () => {
    try {
      await interaction.editReply({ components: [] });
    } catch (e) {}
  });
}

client.login(token);[]
