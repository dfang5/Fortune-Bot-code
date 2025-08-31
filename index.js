const fs = require('fs');
const path = require('path');
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
  ComponentType
} = require('discord.js');
require('dotenv').config();
const DEVELOPER_ID = '1299875574894039184';
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
const DATA_FILE = path.join(__dirname, 'data.json');
const COOLDOWN_FILE = path.join(__dirname, 'cooldowns.json');

// Load persistent data
let userData = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE)) : {};
let cooldowns = fs.existsSync(COOLDOWN_FILE) ? JSON.parse(fs.readFileSync(COOLDOWN_FILE)) : { scavenge: {}, labor: {} };

if (!userData.guildItems) userData.guildItems = {}; // 🧠 Server-specific custom items
if (!userData.xpData) userData.xpData = {}; // XP tracking data
global.tempItems = {}; // 💾 Store items awaiting confirmation
global.activeTrades = {}; // Store active trade sessions
global.activeMarbleGames = {}; // Store active marble game sessions
global.messageTracker = {}; // Track recent messages for conversation detection

// Save functions
function saveUserData() { fs.writeFileSync(DATA_FILE, JSON.stringify(userData, null, 2)); }
function saveCooldowns() { fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(cooldowns, null, 2)); }

// Rarity and artefact config
const rarities = [
  { name:'Common', chance:65, color:0xAAAAAA, value:100, sell:150, items:['Quartz','Mica','Olivine'] },
  { name:'Uncommon', chance:20, color:0x00FF00, value:700, sell:550, items:['Garnet','Talc','Magnetite'] },
  { name:'Rare', chance:10, color:0x00008B, value:2500, sell:1500, items:['Eye of Monazite','Chest of Xenotime','Euxenite'] },
  { name:'Legendary', chance:4, color:0xFFD700, value:10000, sell:10000, items:['Watch of Scandium','Statue of Bastnasite','Allanite'] },
  { name:'Unknown', chance:1, color:0x000000, value:1000000, sell:1000000, items:['Gem of Diamond','Kyawthuite'] }
];
function getRarityByArtefact(name) { return rarities.find(r => r.items.includes(name)); }

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

  const userId = message.author.id;
  const channelId = message.channel.id;
  const now = Date.now();

  // Initialize user data if needed
  if (!userData[userId]) userData[userId] = { cash: 0, artefacts: [], bankBalance: 0 };
  if (!userData.xpData[userId]) userData.xpData[userId] = { xp: 0, messageCount: 0, lastMessage: 0 };

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
    userData.xpData[userId].messageCount++;

    // Award XP every 2 messages
    if (userData.xpData[userId].messageCount % 2 === 0) {
      userData.xpData[userId].xp++;
      userData.xpData[userId].lastMessage = now;
      saveUserData();
    }
  }
});

client.once('clientReady', async () => {
  console.log(`Fortune Bot online as ${client.user.tag}`);

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
      .setName('sell')
      .setDescription('Sell a specific artefact for cash')
      .addStringOption(option =>
        option.setName('artefact')
          .setDescription('Name of the artefact to sell')
          .setRequired(true)
          .setAutocomplete(true)),

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
      .setDescription('View all the items that admins have added'),

    new SlashCommandBuilder()
      .setName('mass-sell')
      .setDescription('Sell multiple artefacts at once'),

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
          .setRequired(false)),

    new SlashCommandBuilder()
      .setName('remove-item')
      .setDescription('Remove a custom server item (Admin only)')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('Name of the item to remove')
          .setRequired(true)),

    new SlashCommandBuilder()
      .setName('view-items')
      .setDescription('View all custom server items (Admin only)'),

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
      ),

    new SlashCommandBuilder()
      .setName('convert')
      .setDescription('Convert your XP into cash (1 XP = $2)'),

  ];

  const rest = new REST({ version:'10' }).setToken(token);

  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(Routes.applicationCommands(clientId), { 
      body: commands.map(command => command.toJSON()) 
    });
    console.log('Successfully reloaded application (/) commands.');
  } catch (err) { 
    console.error('Error registering commands:', err); 
  }
});

// Handle autocomplete interactions
client.on('interactionCreate', async interaction => {
  if (interaction.isAutocomplete()) {
    const { commandName, focusedOption } = interaction;

    if (commandName === 'sell' && focusedOption.name === 'artefact') {
      const userId = interaction.user.id;
      if (!userData[userId]) userData[userId] = { cash: 0, artefacts: [], bankBalance: 0 };

      const userArtefacts = userData[userId].artefacts || [];
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

  // Handle component interactions (buttons, select menus)
  if (interaction.isStringSelectMenu() || interaction.isButton()) {
    return await handleComponentInteraction(interaction);
  }

  if (interaction.isModalSubmit()) {
    const { customId } = interaction;

    if (customId.startsWith('number_modal_')) {
      const gameId = customId.replace('number_modal_', '');
      await processNumberGuess(interaction, gameId);
      return;
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;
  if (!userData[userId]) userData[userId] = { cash: 0, artefacts: [], bankBalance: 0 };

  try {
    switch (interaction.commandName) {
      case 'info':
        await handleInfoCommand(interaction);
        break;
      case 'bank':
        await handleBankCommand(interaction, userId);
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
        await handleSellCommand(interaction, userId);
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

      case 'convert':
        await handleConvertCommand(interaction, userId);
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
      }
    } catch (replyError) {
      console.error('Failed to send error message:', replyError);
    }
  }
});

// Command handlers
async function handleInfoCommand(interaction) {
  const infoEmbed = new EmbedBuilder()
    .setTitle('⚡ Fortune Bot - Build Your Empire')
    .setDescription('**Welcome to Fortune Bot!** Build your fortune through virtual currency, collect rare artefacts, trade with players, and climb the leaderboards!')
    .setColor(0x2F3136)
    .setThumbnail('https://cdn.discordapp.com/emojis/1234567890123456789.png')
    .addFields(
      {
        name: '⚒️ Core Commands',
        value: [
          '`/scavenge` - Search for rare artefacts (2h cooldown)',
          '`/labor` - Work to earn money (40min cooldown)',
          '`/inventory` - View your cash, bank balance and artefacts',
          '`/sell [artefact]` - Sell a specific artefact for cash',
          '`/mass-sell` - Sell all artefacts at once',
          '`/trade [user]` - Interactive trading with other players',
          '`/store` - View items available for purchase'
        ].join('\n'),
        inline: false
      },
      {
        name: '🏦 Banking System',
        value: [
          '`/bank [amount]` - Deposit money (max $50,000 total)',
          '`/withdraw [amount]` - Withdraw money from bank',
          '`/steal [user] [amount]` - Steal cash from other players',
          '**Note:** Only cash on hand can be stolen, bank money is protected'
        ].join('\n'),
        inline: false
      },
      {
        name: '👥 Social & Admin Features',
        value: [
          '`/leaderboard` - View wealth rankings',
          '`/store` - View custom server items',
          '`/add-item [name] [price]` - Add custom server item (Admin)',
          '`/remove-item [name]` - Remove server item (Admin)',
          '`/view-items` - Manage server items (Admin)'
        ].join('\n'),
        inline: false
      },
      {
        name: '💎 Rarity Levels',
        value: [
          '**Common** (65%) - $100-150',
          '**Uncommon** (20%) - $550-700', 
          '**Rare** (10%) - $1,500-2,500',
          '**Legendary** (4%) - $5,000',
          '**Unknown** (1%) - $15,000'
        ].join('\n'),
        inline: false
      }
    )
    .setFooter({ text: '💡 Tip: Start with /scavenge to find your first artefact!' })
    .setTimestamp();

  await interaction.reply({ embeds: [infoEmbed] });
}

// Banking command handlers
async function handleBankCommand(interaction, userId) {
  const amount = interaction.options.getInteger('amount');

  const currentBank = userData[userId].bankBalance || 0;
  const maxDeposit = 50000 - currentBank;

  // Check bank capacity
  if (amount > maxDeposit) {
    const capacityEmbed = new EmbedBuilder()
      .setTitle('Bank Capacity Exceeded')
      .setDescription('Your deposit would exceed the maximum bank capacity.')
      .addFields(
        { name: 'Maximum Deposit Available', value: `$${maxDeposit.toLocaleString()}`, inline: true },
        { name: 'Current Bank Balance', value: `$${currentBank.toLocaleString()}`, inline: true },
        { name: 'Bank Limit', value: '$50,000', inline: true },
        { name: 'Bank Usage', value: `${((currentBank / 50000) * 100).toFixed(1)}%`, inline: false }
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
  saveUserData();

  const successEmbed = new EmbedBuilder()
    .setTitle('Bank Deposit Completed')
    .setDescription(`Successfully deposited $${amount.toLocaleString()} into your secure bank account.`)
    .addFields(
      { name: 'Transaction Amount', value: `$${amount.toLocaleString()}`, inline: true },
      { name: 'Remaining Cash', value: `$${userData[userId].cash.toLocaleString()}`, inline: true },
      { name: 'New Bank Balance', value: `$${userData[userId].bankBalance.toLocaleString()}`, inline: true },
      { name: 'Bank Capacity Used', value: `${((userData[userId].bankBalance / 50000) * 100).toFixed(1)}%`, inline: true },
      { name: 'Available Space', value: `$${(50000 - userData[userId].bankBalance).toLocaleString()}`, inline: true },
      { name: 'Security Status', value: 'Funds Protected', inline: true }
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
  saveUserData();

  const successEmbed = new EmbedBuilder()
    .setTitle('Bank Withdrawal Completed')
    .setDescription(`Successfully withdrew $${amount.toLocaleString()} from your bank account.`)
    .addFields(
      { name: 'Transaction Amount', value: `$${amount.toLocaleString()}`, inline: true },
      { name: 'New Cash Balance', value: `$${userData[userId].cash.toLocaleString()}`, inline: true },
      { name: 'Remaining Bank Funds', value: `$${userData[userId].bankBalance.toLocaleString()}`, inline: true },
      { name: 'Bank Capacity Used', value: `${((userData[userId].bankBalance / 50000) * 100).toFixed(1)}%`, inline: true },
      { name: 'Available Space', value: `$${(50000 - userData[userId].bankBalance).toLocaleString()}`, inline: true },
      { name: 'Risk Status', value: 'Cash Vulnerable to Theft', inline: true }
    )
    .setColor(0x339AF0)
    .setFooter({ text: 'Warning: Cash on hand can be stolen by other players' })
    .setTimestamp();

  await interaction.reply({ embeds: [successEmbed] });
}

async function handleStealCommand(interaction, userId) {
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
    saveUserData();

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
    // Theft failed
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

    return await interaction.reply({ embeds: [cooldownEmbed] });
  }

  // Random artefact generation
  const random = Math.random() * 100;
  let selectedRarity = null;
  let cumulative = 0;

  for (const rarity of rarities) {
    cumulative += rarity.chance;
    if (random <= cumulative) {
      selectedRarity = rarity;
      break;
    }
  }

  const artefact = selectedRarity.items[Math.floor(Math.random() * selectedRarity.items.length)];
  userData[userId].artefacts.push(artefact);
  cooldowns.scavenge[userId] = now;

  saveUserData();
  saveCooldowns();

  const scavengeEmbed = new EmbedBuilder()
    .setTitle('Scavenge Complete')
    .setDescription('You discovered a valuable artefact during your search!')
    .addFields(
      { name: 'Artefact Found', value: `${artefact}`, inline: true },
      { name: 'Rarity', value: `${selectedRarity.name}`, inline: true },
      { name: 'Estimated Value', value: `$${selectedRarity.value.toLocaleString()}`, inline: true },
      { name: 'Next Scavenge', value: 'Available in 2 hours', inline: false }
    )
    .setColor(selectedRarity.color)
    .setTimestamp();

  await interaction.reply({ embeds: [scavengeEmbed] });
}

async function handleLaborCommand(interaction, userId) {
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

    return await interaction.reply({ embeds: [cooldownEmbed] });
  }

  const earnings = Math.floor(Math.random() * 500) + 100; // $100-600
  userData[userId].cash += earnings;
  cooldowns.labor[userId] = now;

  saveUserData();
  saveCooldowns();

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

  await interaction.reply({ embeds: [laborEmbed] });
}

async function handleInventoryCommand(interaction, userId) {
  const user = userData[userId];
  const userXpData = userData.xpData[userId] || { xp: 0, messageCount: 0, lastMessage: 0 };
  
  const totalValue = user.artefacts.reduce((sum, artefact) => {
    const rarity = getRarityByArtefact(artefact);
    return sum + (rarity ? rarity.value : 0);
  }, 0);

  const artefactList = user.artefacts.length ? 
    user.artefacts.map(artefact => {
      const rarity = getRarityByArtefact(artefact);
      return `${artefact} (${rarity ? rarity.name : 'Unknown'})`;
    }).join('\n') : 'No artefacts';

  const inventoryEmbed = new EmbedBuilder()
    .setTitle('Your Inventory')
    .setDescription('Current financial status and artefact collection')
    .addFields(
      { name: 'Cash on Hand', value: `$${user.cash.toLocaleString()}`, inline: true },
      { name: 'Bank Balance', value: `$${(user.bankBalance || 0).toLocaleString()}`, inline: true },
      { name: 'Total Wealth', value: `$${(user.cash + (user.bankBalance || 0)).toLocaleString()}`, inline: true },
      { name: 'Experience Points', value: `${userXpData.xp.toLocaleString()} XP`, inline: true },
      { name: 'XP Cash Value', value: `$${(userXpData.xp * 2).toLocaleString()}`, inline: true },
      { name: 'Messages Sent', value: `${userXpData.messageCount.toLocaleString()}`, inline: true },
      { name: 'Artefacts Owned', value: user.artefacts.length.toString(), inline: true },
      { name: 'Collection Value', value: `$${totalValue.toLocaleString()}`, inline: true },
      { name: 'Bank Capacity', value: `${(((user.bankBalance || 0) / 50000) * 100).toFixed(1)}%`, inline: true },
      { name: 'Artefact Collection', value: artefactList, inline: false }
    )
    .setColor(0x339AF0)
    .setFooter({ text: 'Use /convert to turn XP into cash (1 XP = $2)' })
    .setTimestamp();

  await interaction.reply({ embeds: [inventoryEmbed] });
}

async function handleSellCommand(interaction, userId) {
  const user = userData[userId];
  const artefactName = interaction.options.getString('artefact');

  if (!user.artefacts.length) {
    const noArtefactsEmbed = new EmbedBuilder()
      .setTitle('No Artefacts to Sell')
      .setDescription('You need to find some artefacts first before you can sell them.')
      .addFields({ name: 'How to Find Artefacts', value: 'Use `/scavenge` to search for rare artefacts', inline: false })
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.reply({ embeds: [noArtefactsEmbed] });
  }

  const artefactIndex = user.artefacts.findIndex(item => item === artefactName);
  if (artefactIndex === -1) {
    const notFoundEmbed = new EmbedBuilder()
      .setTitle('Artefact Not Found')
      .setDescription(`You don't have an artefact named "${artefactName}".`)
      .addFields({ name: 'Check Your Inventory', value: 'Use `/inventory` to see what artefacts you own', inline: false })
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.reply({ embeds: [notFoundEmbed] });
  }

  const rarity = getRarityByArtefact(artefactName);
  const sellValue = rarity ? rarity.sell : 100;

  userData[userId].cash += sellValue;
  userData[userId].artefacts.splice(artefactIndex, 1);
  saveUserData();

  const sellEmbed = new EmbedBuilder()
    .setTitle('Artefact Sold')
    .setDescription(`You successfully sold your ${artefactName}.`)
    .addFields(
      { name: 'Artefact', value: artefactName, inline: true },
      { name: 'Rarity', value: rarity ? rarity.name : 'Unknown', inline: true },
      { name: 'Sale Price', value: `$${sellValue.toLocaleString()}`, inline: true },
      { name: 'New Cash Balance', value: `$${userData[userId].cash.toLocaleString()}`, inline: false }
    )
    .setColor(0x51CF66)
    .setTimestamp();

  await interaction.reply({ embeds: [sellEmbed] });
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
    .setTitle('🤝 Trade Request')
    .setDescription(`**${interaction.user.displayName}** wants to trade with you!`)
    .addFields(
      { name: '👤 Initiator', value: `<@${userId}>`, inline: true },
      { name: '🎯 Recipient', value: `<@${targetUser.id}>`, inline: true },
      { name: '📊 Status', value: '⏳ Waiting for response...', inline: false },
      { name: '⚡ Action Required', value: 'Choose **Accept** or **Decline** below', inline: false }
    )
    .setColor(0x5865F2)
    .setFooter({ text: '⏰ This request will expire after 2 minutes' })
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
  const users = Object.entries(userData)
    .filter(([id, data]) => data.cash !== undefined)
    .sort((a, b) => (b[1].cash + (b[1].bankBalance || 0)) - (a[1].cash + (a[1].bankBalance || 0)))
    .slice(0, 10);

  if (!users.length) {
    const emptyEmbed = new EmbedBuilder()
      .setTitle('Leaderboard')
      .setDescription('No players have earned money yet.')
      .setColor(0x339AF0)
      .setTimestamp();

    return await interaction.reply({ embeds: [emptyEmbed] });
  }

  const leaderboardEmbed = new EmbedBuilder()
    .setTitle('🏆 Top Fortune Holders')
    .setDescription(users.map(([id, data], i) => {
      const totalWealth = data.cash + (data.bankBalance || 0);
      const medals = ['🥇', '🥈', '🥉'];
      const medal = medals[i] || '🔸';
      return `${medal} **${i + 1}.** <@${id}> - **$${totalWealth.toLocaleString()}**`;
    }).join('\n'))
    .setColor(0xFFD700)
    .setFooter({ text: '💰 Rankings based on total wealth (cash + bank balance)' })
    .setTimestamp();

  await interaction.reply({ embeds: [leaderboardEmbed] });
}

async function handleStoreCommand(interaction) {
  const guildId = interaction.guild.id;
  const guildItems = userData.guildItems?.[guildId] || {};

  if (Object.keys(guildItems).length === 0) {
    const emptyStoreEmbed = new EmbedBuilder()
      .setTitle('Server Store')
      .setDescription('This server currently has no custom items available for purchase.')
      .addFields(
        { name: 'Get Started', value: 'Ask an administrator to add items using `/add-item`', inline: false },
        { name: 'Available Commands', value: '`/add-item` - Add new items (Admin only)\n`/view-items` - Manage items (Admin only)', inline: false }
      )
      .setColor(0x6C7B7F)
      .setTimestamp();

    return await interaction.reply({ embeds: [emptyStoreEmbed] });
  }

  const itemList = Object.entries(guildItems)
    .map(([name, data]) => `**${name}**\nPrice: $${data.price.toLocaleString()}\n${data.description}`)
    .join('\n\n');

  const storeEmbed = new EmbedBuilder()
    .setTitle('🏪 Server Store')
    .setDescription(`**Browse ${Object.keys(guildItems).length} available items** in this server.`)
    .addFields(
      { name: '📋 Available Items', value: itemList, inline: false },
      { name: '💳 How to Purchase', value: 'Contact **server administrators** to purchase items', inline: false }
    )
    .setColor(0x9932CC)
    .setFooter({ text: '🎆 Items shown are server-specific custom additions' })
    .setTimestamp();

  await interaction.reply({ embeds: [storeEmbed] });
}

// New command handlers
async function handleMassSellCommand(interaction, userId) {
  const user = userData[userId];

  if (!user.artefacts.length) {
    const noArtefactsEmbed = new EmbedBuilder()
      .setTitle('No Artefacts to Sell')
      .setDescription('You need to find some artefacts first before you can sell them.')
      .addFields({ name: 'How to Find Artefacts', value: 'Use `/scavenge` to search for rare artefacts', inline: false })
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.reply({ embeds: [noArtefactsEmbed] });
  }

  let totalEarnings = 0;
  const soldItems = [];

  userData[userId].artefacts.forEach(artefact => {
    const rarity = getRarityByArtefact(artefact);
    const sellValue = rarity ? rarity.sell : 100;
    totalEarnings += sellValue;
    soldItems.push(`${artefact} - $${sellValue.toLocaleString()}`);
  });

  userData[userId].cash += totalEarnings;
  userData[userId].artefacts = [];
  saveUserData();

  const massellEmbed = new EmbedBuilder()
    .setTitle('Mass Sale Complete')
    .setDescription('Successfully sold your entire artefact collection.')
    .addFields(
      { name: 'Items Sold', value: soldItems.join('\n'), inline: false },
      { name: 'Total Earnings', value: `$${totalEarnings.toLocaleString()}`, inline: true },
      { name: 'New Cash Total', value: `$${userData[userId].cash.toLocaleString()}`, inline: true }
    )
    .setColor(0x51CF66)
    .setTimestamp();

  await interaction.reply({ embeds: [massellEmbed] });
}

async function handleAddItemCommand(interaction) {
  // Check if user is admin
  if (interaction.user.id !== DEVELOPER_ID && !interaction.member.permissions.has('Administrator')) {
    const noPermEmbed = new EmbedBuilder()
      .setTitle('Access Denied')
      .setDescription('Only administrators can add custom server items.')
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.reply({ embeds: [noPermEmbed] });
  }

  const itemName = interaction.options.getString('name');
  const itemPrice = interaction.options.getInteger('price');
  const itemDescription = interaction.options.getString('description') || 'Custom server item';
  const guildId = interaction.guild.id;

  if (!userData.guildItems) userData.guildItems = {};
  if (!userData.guildItems[guildId]) userData.guildItems[guildId] = {};

  userData.guildItems[guildId][itemName] = {
    price: itemPrice,
    description: itemDescription,
    addedBy: interaction.user.id,
    addedAt: Date.now()
  };

  saveUserData();

  const addEmbed = new EmbedBuilder()
    .setTitle('✅ Item Added Successfully')
    .setDescription(`**Added "${itemName}"** to the server store.`)
    .addFields(
      { name: '🏷️ Item Name', value: `**${itemName}**`, inline: true },
      { name: '💰 Price', value: `**$${itemPrice.toLocaleString()}**`, inline: true },
      { name: '📋 Description', value: itemDescription, inline: false }
    )
    .setColor(0x00FF7F)
    .setTimestamp();

  await interaction.reply({ embeds: [addEmbed] });
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

  if (!userData.guildItems || !userData.guildItems[guildId] || !userData.guildItems[guildId][itemName]) {
    const notFoundEmbed = new EmbedBuilder()
      .setTitle('Item Not Found')
      .setDescription(`No custom item named "${itemName}" exists in this server.`)
      .setColor(0xFF6B6B)
      .setTimestamp();

    return await interaction.reply({ embeds: [notFoundEmbed] });
  }

  delete userData.guildItems[guildId][itemName];
  saveUserData();

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
  const guildItems = userData.guildItems?.[guildId] || {};

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
      // All players accepted, proceed to team selection
      await handleTeamSelection(interaction, gameId);
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
      .setTitle('🚫 Marble Game Cancelled')
      .setDescription(`**${declinedUser.displayName}** has declined the invitation. The marble game has been cancelled.`)
      .setColor(0xFF6B6B)
      .setTimestamp();

    await interaction.update({ embeds: [declineEmbed], components: [] });

    // Clean up the game
    delete global.activeMarbleGames[gameId];

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

  } else if (customId.startsWith('bet_modal_')) {
    const gameId = customId.replace('bet_modal_', '');
    const game = global.activeMarbleGames[gameId];
    if (!game) return;

    const userId = interaction.user.id;
    const betAmount = parseInt(interaction.fields.getTextInputValue('bet_amount_input'));

    if (isNaN(betAmount) || betAmount <= 0) {
      return await interaction.reply({ content: '❌ Invalid bet amount! Please enter a positive number.', ephemeral: true });
    }

    if (userData[userId].cash < betAmount) {
      return await interaction.reply({ content: `❌ You don\'t have enough cash to bet $${betAmount.toLocaleString()}! You have $${userData[userId].cash.toLocaleString()}.`, ephemeral: true });
    }

    // Store the bet temporarily
    if (!game.pendingBets) game.pendingBets = {};
    game.pendingBets[userId] = betAmount;

    // Update the embed to show the pending bet
    const updatedEmbed = createBettingEmbed(game, userId, betAmount);
    await interaction.update({ embeds: [updatedEmbed] });

    // Check if all players have placed their bets
    if (Object.keys(game.pendingBets).length === game.players.length) {
      const allBets = Object.values(game.pendingBets);
      const firstBet = allBets[0];

      if (allBets.every(bet => bet === firstBet)) {
        // All bets match, proceed to collect bets and start the game
        game.betAmount = firstBet;
        game.totalPot = firstBet * game.players.length;
        await collectBets(game); // Deduct bets from players
        await startMarbleGame(interaction, gameId);
      } else {
        // Bets do not match, reset and prompt again
        const mismatchEmbed = new EmbedBuilder()
          .setTitle('💸 Bets Do Not Match!')
          .setDescription('**Bets do not match!** Please place your bets again.')
          .setColor(0xFF6B6B)
          .setTimestamp();
        
        await interaction.message.edit({ embeds: [mismatchEmbed], components: [] });
        delete global.activeMarbleGames[gameId]; // Clean up this game instance
      }
    }

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
    if (!trade) return;

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
    if (!trade) return;

    const userId = interaction.user.id;
    const artefactIndex = parseInt(interaction.values[0]);
    const artefact = userData[userId].artefacts[artefactIndex];

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

    await interaction.deferUpdate();

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

    const userXpData = userData.xpData[userId];
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
    userData.xpData[userId].xp = 0;
    saveUserData();

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

function createTradeEmbed(trade, initiatorId, recipientId) {
  const initiatorOfferText = formatOffer(trade.initiatorOffer);
  const recipientOfferText = formatOffer(trade.recipientOffer);

  return new EmbedBuilder()
    .setTitle('⚡ Interactive Trade Session')
    .setDescription('**Both players can add items, cash, or artefacts to the trade**')
    .addFields(
      { name: '👤 Initiator Offer', value: initiatorOfferText || '*Nothing offered yet*', inline: true },
      { name: '🎯 Recipient Offer', value: recipientOfferText || '*Nothing offered yet*', inline: true },
      { name: '📊 Trade Status', value: getTradeStatus(trade), inline: false },
      { name: '📋 Instructions', value: 'Use the buttons below to **add/remove** items from your offer. Both players must click **Ready** to complete the trade.', inline: false }
    )
    .setColor(trade.initiatorReady && trade.recipientReady ? 0x00FF7F : 0x4169E1)
    .setFooter({ text: '⏰ Trade will expire after 10 minutes of inactivity' })
    .setTimestamp();
}

function formatOffer(offer) {
  const parts = [];
  if (offer.cash > 0) parts.push(`$${offer.cash.toLocaleString()}`);
  if (offer.artefacts.length > 0) parts.push(offer.artefacts.join(', '));
  return parts.join('\n') || 'Nothing';
}

function getTradeStatus(trade) {
  if (trade.initiatorReady && trade.recipientReady) return '✅ **Both players ready** - Trade will complete automatically';
  if (trade.initiatorReady) return '⏳ **Initiator ready**, waiting for recipient';
  if (trade.recipientReady) return '⏳ **Recipient ready**, waiting for initiator';
  return '⚒️ **Setting up offers...**';
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
    return {
      label: artefact,
      description: `${rarity ? rarity.name : 'Unknown'} - $${rarity ? rarity.value.toLocaleString() : '100'}`,
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

  saveUserData();
  delete global.activeTrades[tradeId];

  const successEmbed = new EmbedBuilder()
    .setTitle('🎉 Trade Completed Successfully!')
    .setDescription('**The trade has been executed and all items have been exchanged!**')
    .addFields(
      { name: '📦 Initiator Received', value: formatOffer(trade.recipientOffer) || '*Nothing*', inline: true },
      { name: '📦 Recipient Received', value: formatOffer(trade.initiatorOffer) || '*Nothing*', inline: true }
    )
    .setColor(0x00FF7F)
    .setTimestamp();

  await interaction.update({ embeds: [successEmbed], components: [] });
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

  // Validation checks
  const players = [interaction.user, player2, player3, player4];
  const uniquePlayerIds = new Set(players.map(p => p.id));

  if (uniquePlayerIds.size !== 4) {
    return await interaction.reply({ 
      content: '❌ **Error:** All four players must be different users!', 
      ephemeral: true 
    });
  }

  if (players.some(p => p.bot)) {
    return await interaction.reply({ 
      content: '❌ **Error:** Bots cannot participate in marble games!', 
      ephemeral: true 
    });
  }

  // Check if any player is already in a game
  const existingGame = Object.values(global.activeMarbleGames).find(game => 
    game.players.some(p => players.some(player => player.id === p.id))
  );

  if (existingGame) {
    return await interaction.reply({ 
      content: '❌ **Error:** One or more players are already in an active marble game!', 
      ephemeral: true 
    });
  }

  // Create game ID and initialize game
  const gameId = `${userId}_${Date.now()}`;
  global.activeMarbleGames[gameId] = {
    gameId,
    initiator: interaction.user,
    players: players,
    invited: [player2, player3, player4],
    accepted: [],
    declined: [],
    pendingBets: {}, // To store individual player bets before they match
    betAmount: 0, // Will be set once bets match
    totalPot: 0,
    betsCollected: false,
    phase: 'invitation',
    createdAt: Date.now()
  };

  const invitationEmbed = createInvitationEmbed(global.activeMarbleGames[gameId]);
  const buttons = createInvitationButtons(gameId);

  await interaction.reply({ 
    embeds: [invitationEmbed], 
    components: [buttons],
    ephemeral: false 
  });
}

function createInvitationEmbed(game) {
  const pending = game.invited.filter(p => 
    !game.accepted.includes(p.id) && !game.declined.includes(p.id)
  );

  return new EmbedBuilder()
    .setTitle('🎲 Marble Gambling Challenge')
    .setDescription(`**${game.initiator.displayName}** has challenged you to a marble gambling contest!`)
    .addFields(
      { 
        name: '👥 Players Invited', 
        value: game.invited.map(p => `<@${p.id}>`).join(', '), 
        inline: false 
      },
      { 
        name: '💰 Betting Details', 
        value: `**Bet per Player:** To be determined\\n**Total Pot:** To be determined`, 
        inline: false 
      },
      { 
        name: '⏳ Pending Responses', 
        value: pending.length > 0 ? pending.map(p => `<@${p.id}>`).join(', ') : '*None*', 
        inline: true 
      },
      { 
        name: '✅ Accepted', 
        value: game.accepted.length > 0 ? game.accepted.map(id => `<@${id}>`).join(', ') : '*None*', 
        inline: true 
      },
      {
        name: '🎯 Game Rules',
        value: '• **4 players** split into 2 teams\\n• Each team starts with **10 marbles**\\n• Guess numbers 1-20 to win marbles\\n• First team to **0 marbles loses**, other team wins with **20 marbles**\\n• **Winning team splits the entire pot!**',
        inline: false
      }
    )
    .setColor(0xFF6B35)
    .setFooter({ text: '⏰ This invitation expires after 2 minutes' })
    .setTimestamp();
}

function createInvitationButtons(gameId) {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`marble_accept_${gameId}`)
        .setLabel('Accept Challenge')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`marble_decline_${gameId}`)
        .setLabel('Decline')
        .setStyle(ButtonStyle.Danger)
    );
}

async function handleTeamSelection(interaction, gameId) {
  const game = global.activeMarbleGames[gameId];
  if (!game) return;

  // Move to betting phase
  game.phase = 'betting';

  await startBettingPhase(interaction, gameId);
}

async function startBettingPhase(interaction, gameId) {
  const game = global.activeMarbleGames[gameId];
  if (!game) return;

  const bettingEmbed = new EmbedBuilder()
    .setTitle('💰 Betting Phase')
    .setDescription('**All players must place their bets now!** Each player can bet any amount they want, but all bets must match to proceed.')
    .addFields(
      { 
        name: '🎮 Players', 
        value: game.players.map(p => `<@${p.id}>`).join(', '), 
        inline: false 
      },
      { 
        name: '📋 Instructions', 
        value: '• Each player must click "Place Bet" below\n• Enter your desired bet amount (minimum $50)\n• All players must bet the same amount\n• Game will start once all bets match', 
        inline: false 
      },
      { 
        name: '🎯 Current Bets', 
        value: 'No bets placed yet', 
        inline: false 
      }
    )
    .setColor(0xFFD700)
    .setTimestamp();

  const betButton = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`place_bet_${gameId}`)
        .setLabel('Place Bet')
        .setStyle(ButtonStyle.Primary)
    );

  await interaction.editReply({ 
    embeds: [bettingEmbed], 
    components: [betButton] 
  });
}

function createBettingEmbed(game, userId, betAmount) {
  const pendingBets = game.pendingBets || {};
  const userBet = pendingBets[userId];

  let currentBetsDescription = 'No bets placed yet';
  if (Object.keys(pendingBets).length > 0) {
    currentBetsDescription = Object.entries(pendingBets)
      .map(([id, bet]) => `<@${id}> - $${bet.toLocaleString()}`)
      .join('\n');
  }

  let statusMessage = 'Waiting for all players to place their bets...';
  let color = 0xFFD700; // Yellow for pending

  if (Object.keys(pendingBets).length === game.players.length) {
    const allBets = Object.values(pendingBets);
    if (allBets.every(bet => bet === allBets[0])) {
      statusMessage = `**All bets match!** $${allBets[0].toLocaleString()} per player. Game starting soon!`;
      color = 0x00FF7F; // Green for matched bets
    } else {
      statusMessage = 'Bets do not match! Please try again.';
      color = 0xFF6B6B; // Red for mismatch
    }
  }

  return new EmbedBuilder()
    .setTitle('💰 Betting Phase')
    .setDescription(statusMessage)
    .addFields(
      { 
        name: '🎮 Players', 
        value: game.players.map(p => `<@${p.id}>`).join(', '), 
        inline: false 
      },
      { 
        name: '🎯 Current Bets', 
        value: currentBetsDescription, 
        inline: false 
      },
      {
        name: '📋 Next Steps',
        value: '• All players must bet the same amount\n• If bets do not match, the game will be cancelled.',
        inline: false
      }
    )
    .setColor(color)
    .setTimestamp();
}

async function collectBets(game) {
  if (game.betsCollected) return;

  // Deduct bet amount from all players
  for (const player of game.players) {
    userData[player.id].cash -= game.betAmount;
  }

  game.betsCollected = true;
  saveUserData();
}

async function startMarbleGame(interaction, gameId) {
  const game = global.activeMarbleGames[gameId];
  if (!game) return;

  // For simplicity, randomly assign teams
  const shuffledPlayers = [...game.players].sort(() => Math.random() - 0.5);
  game.teamA = shuffledPlayers.slice(0, 2);
  game.teamB = shuffledPlayers.slice(2, 4);
  game.teamAMarbles = 10;
  game.teamBMarbles = 10;
  game.phase = 'game';
  game.round = 1;
  game.playerGuesses = {};

  // Coin flip to determine starting team
  const coinFlip = Math.random() < 0.5 ? 'heads' : 'tails';
  game.currentTeam = coinFlip === 'heads' ? 'A' : 'B';
  game.currentPlayerIndex = 0;

  const gameStartEmbed = createGameEmbed(game, coinFlip);
  const numberButton = createNumberSelectionButton(gameId);

  const channel = interaction.channel;
  await channel.send({ 
    embeds: [gameStartEmbed], 
    components: [numberButton] 
  });
}

function createGameEmbed(game, coinFlip = null) {
  const currentTeam = game.currentTeam === 'A' ? game.teamA : game.teamB;
  const currentPlayer = currentTeam[game.currentPlayerIndex];

  let description = `**Round ${game.round}** - Marble Gambling in Progress!`;
  if (coinFlip) {
    description += `\n\n🪙 **Coin Flip Result:** ${coinFlip.toUpperCase()}\n**Team ${game.currentTeam}** goes first!`;
  }

  return new EmbedBuilder()
    .setTitle('🎲 Marble Game - Active')
    .setDescription(description)
    .addFields(
      { 
        name: '🔴 Team A', 
        value: `**Players:** ${game.teamA.map(p => p.displayName).join(', ')}\n**Marbles:** ${game.teamAMarbles}/20`, 
        inline: true 
      },
      { 
        name: '🔵 Team B', 
        value: `**Players:** ${game.teamB.map(p => p.displayName).join(', ')}\n**Marbles:** ${game.teamBMarbles}/20`, 
        inline: true 
      },
      { 
        name: '🎯 Current Turn', 
        value: `**${currentPlayer.displayName}** (Team ${game.currentTeam})\nChoose a number from 1-20!`, 
        inline: false 
      }
    )
    .setColor(game.currentTeam === 'A' ? 0xFF4444 : 0x4444FF)
    .setFooter({ text: `🎲 Round ${game.round} • Waiting for number selection` })
    .setTimestamp();
}

function createNumberSelectionButton(gameId) {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`select_number_${gameId}`)
        .setLabel('Select Number (1-20)')
        .setStyle(ButtonStyle.Primary)
    );
}

async function handleNumberSelection(interaction, gameId) {
  const game = global.activeMarbleGames[gameId];
  if (!game) return;

  const currentTeam = game.currentTeam === 'A' ? game.teamA : game.teamB;
  const currentPlayer = currentTeam[game.currentPlayerIndex];

  if (interaction.user.id !== currentPlayer.id) {
    return await interaction.reply({ 
      content: '❌ **It\'s not your turn!**', 
      ephemeral: true 
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(`number_modal_${gameId}`)
    .setTitle('Choose Your Number')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('number_input')
          .setLabel('Enter a number from 1 to 20')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(2)
          .setRequired(true)
      )
    );

  await interaction.showModal(modal);
}

async function processNumberGuess(interaction, gameId) {
  const game = global.activeMarbleGames[gameId];
  if (!game) return;

  const number = parseInt(interaction.fields.getTextInputValue('number_input'));

  if (isNaN(number) || number < 1 || number > 20) {
    return await interaction.reply({ 
      content: '❌ **Invalid number!** Please enter a number between 1 and 20.', 
      ephemeral: true 
    });
  }

  const playerId = interaction.user.id;
  game.playerGuesses[playerId] = number;

  await interaction.reply({ 
    content: `✅ **You selected ${number}!** Waiting for other players...`, 
    ephemeral: true 
  });

  // Move to next player
  const currentTeamArray = game.currentTeam === 'A' ? game.teamA : game.teamB;
  game.currentPlayerIndex++;

  // Check if all players in current team have guessed
  if (game.currentPlayerIndex >= currentTeamArray.length) {
    // Switch to other team
    if (game.currentTeam === 'A') {
      game.currentTeam = 'B';
      game.currentPlayerIndex = 0;
    } else {
      // All players have guessed, run the randomizer
      await runRandomizer(interaction, gameId);
      return;
    }
  }

  // Update embed for next player
  const updatedEmbed = createGameEmbed(game);
  const numberButton = createNumberSelectionButton(gameId);

  await interaction.message.edit({ 
    embeds: [updatedEmbed], 
    components: [numberButton] 
  });
}

async function runRandomizer(interaction, gameId) {
  const game = global.activeMarbleGames[gameId];
  if (!game) return;

  const allGuesses = Object.values(game.playerGuesses);
  let randomNumber;
  let attempts = 0;
  const maxAttempts = 100; // Prevent infinite loops

  // Keep rolling until we hit a guessed number or max attempts
  do {
    randomNumber = Math.floor(Math.random() * 20) + 1;
    attempts++;

    if (attempts >= maxAttempts) {
      // Force a hit to prevent infinite loops
      randomNumber = allGuesses[Math.floor(Math.random() * allGuesses.length)];
      break;
    }

    if (!allGuesses.includes(randomNumber)) {
      // Show re-roll message
      const rerollEmbed = new EmbedBuilder()
        .setTitle('🎲 Randomizer Rolling...')
        .setDescription(`**Number ${randomNumber}** - No hits! Re-rolling in 3 seconds...`)
        .setColor(0xFFA500)
        .setTimestamp();

      await interaction.message.edit({ embeds: [rerollEmbed], components: [] });
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  } while (!allGuesses.includes(randomNumber));

  // Find the winner
  const winnerId = Object.keys(game.playerGuesses).find(
    playerId => game.playerGuesses[playerId] === randomNumber
  );
  const winnerUser = game.players.find(p => p.id === winnerId);
  const winnerTeam = game.teamA.some(p => p.id === winnerId) ? 'A' : 'B';
  const loserTeam = winnerTeam === 'A' ? 'B' : 'A';

  // Transfer marble
  if (winnerTeam === 'A') {
    game.teamAMarbles++;
    game.teamBMarbles--;
  } else {
    game.teamBMarbles++;
    game.teamAMarbles--;
  }

  const resultEmbed = new EmbedBuilder()
    .setTitle('🎯 Randomiser Result!')
    .setDescription(`**Number ${randomNumber}** was chosen!\n**${winnerUser.displayName}** (Team ${winnerTeam}) wins this round!`)
    .addFields(
      { 
        name: '🏆 Round Winner', 
        value: `**${winnerUser.displayName}** guessed **${randomNumber}**`, 
        inline: false 
      },
      { 
        name: '📊 Current Scores', 
        value: `🔴 **Team A:** ${game.teamAMarbles} marbles\n🔵 **Team B:** ${game.teamBMarbles} marbles`, 
        inline: false 
      }
    )
    .setColor(winnerTeam === 'A' ? 0xFF4444 : 0x4444FF)
    .setTimestamp();

  await interaction.message.edit({ embeds: [resultEmbed], components: [] });

  // Check win condition
  if (game.teamAMarbles === 0 || game.teamBMarbles === 0 || game.teamAMarbles === 20 || game.teamBMarbles === 20) {
    setTimeout(() => endGame(interaction, gameId), 3000);
  } else {
    setTimeout(() => nextRound(interaction, gameId), 5000);
  }
}

async function nextRound(interaction, gameId) {
  const game = global.activeMarbleGames[gameId];
  if (!game) return;

  // Reset for next round
  game.round++;
  game.playerGuesses = {};

  // Flip coin for next round
  const coinFlip = Math.random() < 0.5 ? 'heads' : 'tails';
  game.currentTeam = coinFlip === 'heads' ? 'A' : 'B';
  game.currentPlayerIndex = 0;

  const nextRoundEmbed = createGameEmbed(game, coinFlip);
  const numberButton = createNumberSelectionButton(gameId);

  await interaction.message.edit({ 
    embeds: [nextRoundEmbed], 
    components: [numberButton] 
  });
}

async function endGame(interaction, gameId) {
  const game = global.activeMarbleGames[gameId];
  if (!game) return;

  const winningTeam = game.teamAMarbles === 20 || game.teamBMarbles === 0 ? 'A' : 'B';
  const winningPlayers = winningTeam === 'A' ? game.teamA : game.teamB;
  const finalScoreA = game.teamAMarbles;
  const finalScoreB = game.teamBMarbles;

  // Distribute winnings to winning team
  const winningsPerPlayer = game.totalPot / 2; // Split pot between 2 winners
  for (const player of winningPlayers) {
    userData[player.id].cash += winningsPerPlayer;
  }
  saveUserData();

  const gameEndEmbed = new EmbedBuilder()
    .setTitle('🏆 Marble Game Complete!')
    .setDescription(`**Team ${winningTeam} Wins!**\n\nCongratulations to the victorious players!`)
    .addFields(
      { 
        name: '🎉 Winners', 
        value: winningPlayers.map(p => `**${p.displayName}**`).join('\\n'), 
        inline: true 
      },
      { 
        name: '🎯 Final Score', 
        value: `🔴 **Team A:** ${finalScoreA} marbles\n🔵 **Team B:** ${finalScoreB} marbles`, 
        inline: true 
      },
      { 
        name: '💰 Prize Distribution', 
        value: `**Each Winner Receives:** $${winningsPerPlayer.toLocaleString()}\n**Total Pot:** $${game.totalPot.toLocaleString()}`, 
        inline: false 
      },
      { 
        name: '📊 Game Stats', 
        value: `**Rounds Played:** ${game.round}\n**Duration:** ${Math.round((Date.now() - game.createdAt) / 60000)} minutes`, 
        inline: false 
      }
    )
    .setColor(0x00FF7F)
    .setFooter({ text: 'Winnings have been distributed! Thanks for playing!' })
    .setTimestamp();

  await interaction.message.edit({ embeds: [gameEndEmbed], components: [] });

  // Clean up
  delete global.activeMarbleGames[gameId];
}

// === XP CONVERSION SYSTEM ===

async function handleConvertCommand(interaction, userId) {
  // Initialize user XP data if needed
  if (!userData.xpData[userId]) {
    userData.xpData[userId] = { xp: 0, messageCount: 0, lastMessage: 0 };
  }

  const userXpData = userData.xpData[userId];

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

client.login(token);
