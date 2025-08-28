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
global.tempItems = {}; // 💾 Store items awaiting confirmation

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
      .setName('marble')
      .setDescription('Play the marble gambling game')
      .addIntegerOption(option =>
        option.setName('bet')
          .setDescription('Amount to bet (minimum $50)')
          .setRequired(true)
          .setMinValue(50))
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
      case 'marble':
        await handleMarbleCommand(interaction, userId);
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
    .setTitle('Fortune Bot - Build Your Empire')
    .setDescription('Welcome to Fortune Bot, where you build your fortune in virtual currency, collect rare artefacts, trade with others, and shape your destiny')
    .setColor(0xFFD700)
    .addFields(
      {
        name: 'Core Commands',
        value: [
          '/scavenge - Search for rare artefacts (2h cooldown)',
          '/labor - Work to earn money (40min cooldown)',
          '/inventory - View your cash, bank balance and artefacts',
          '/sell [artefact] - Sell a specific artefact for cash',
          '/mass-sell - Sell all artefacts at once',
          '/trade [user] - Interactive trading with other players',
          '/marble [bet] - Gambling game with 4x payout'
        ].join('\n'),
        inline: false
      },
      {
        name: 'Banking System',
        value: [
          '/bank [amount] - Deposit money (max $50,000 total)',
          '/withdraw [amount] - Withdraw money from bank',
          '/steal [user] [amount] - Steal cash from other players',
          'Note: Only cash on hand can be stolen, bank money is protected'
        ].join('\n'),
        inline: false
      },
      {
        name: 'Social & Admin Features',
        value: [
          '/leaderboard - View wealth rankings',
          '/store - View custom server items',
          '/add-item [name] [price] - Add custom server item (Admin)',
          '/remove-item [name] - Remove server item (Admin)',
          '/view-items - Manage server items (Admin)'
        ].join('\n'),
        inline: false
      },
      {
        name: 'Rarity Levels',
        value: [
          'Common (65%) - $100-150',
          'Uncommon (20%) - $550-700', 
          'Rare (10%) - $1,500-2,500',
          'Legendary (4%) - $5,000',
          'Unknown (1%) - $15,000'
        ].join('\n'),
        inline: false
      }
    )
    .setFooter({ text: 'Tip: Start with /scavenge to find your first artefact' })
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
    .setColor(0x51CF66)
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
    .setDescription(`You discovered a valuable artefact during your search.`)
    .addFields(
      { name: 'Artefact Found', value: artefact, inline: true },
      { name: 'Rarity', value: selectedRarity.name, inline: true },
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
      { name: 'Artefacts Owned', value: user.artefacts.length.toString(), inline: true },
      { name: 'Collection Value', value: `$${totalValue.toLocaleString()}`, inline: true },
      { name: 'Bank Capacity', value: `${(((user.bankBalance || 0) / 50000) * 100).toFixed(1)}%`, inline: true },
      { name: 'Artefact Collection', value: artefactList, inline: false }
    )
    .setColor(0x339AF0)
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
  
  // Initialize target user data if needed
  if (!userData[targetUser.id]) userData[targetUser.id] = { cash: 0, artefacts: [], bankBalance: 0 };
  
  const userArtefacts = userData[userId].artefacts || [];
  const userCash = userData[userId].cash || 0;
  
  if (userArtefacts.length === 0 && userCash === 0) {
    const nothingEmbed = new EmbedBuilder()
      .setTitle('Nothing to Trade')
      .setDescription('You need cash or artefacts to start a trade.')
      .setColor(0xFF6B6B)
      .setTimestamp();
      
    return await interaction.reply({ embeds: [nothingEmbed] });
  }
  
  // Create trade selection menu
  const tradeOptions = [];
  
  if (userCash > 0) {
    tradeOptions.push({
      label: `Cash: $${userCash.toLocaleString()}`,
      description: 'Trade some of your cash',
      value: 'cash'
    });
  }
  
  userArtefacts.forEach((artefact, index) => {
    const rarity = getRarityByArtefact(artefact);
    tradeOptions.push({
      label: artefact,
      description: `${rarity ? rarity.name : 'Unknown'} - $${rarity ? rarity.value.toLocaleString() : '100'}`,
      value: `artefact_${index}`
    });
  });
  
  if (tradeOptions.length === 0) {
    const emptyEmbed = new EmbedBuilder()
      .setTitle('Nothing to Trade')
      .setDescription('You have no cash or artefacts to trade.')
      .setColor(0xFF6B6B)
      .setTimestamp();
      
    return await interaction.reply({ embeds: [emptyEmbed] });
  }
  
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`trade_select_${targetUser.id}`)
    .setPlaceholder('Select what you want to trade')
    .addOptions(tradeOptions.slice(0, 25)); // Discord limit
  
  const row = new ActionRowBuilder().addComponents(selectMenu);
  
  const tradeEmbed = new EmbedBuilder()
    .setTitle('Initialize Trade')
    .setDescription(`Starting trade with ${targetUser.displayName}`)
    .addFields(
      { name: 'Your Cash', value: `$${userCash.toLocaleString()}`, inline: true },
      { name: 'Your Artefacts', value: userArtefacts.length.toString(), inline: true },
      { name: 'Instructions', value: 'Select what you want to offer in this trade', inline: false }
    )
    .setColor(0x339AF0)
    .setTimestamp();
    
  await interaction.reply({ embeds: [tradeEmbed], components: [row] });
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
    .setTitle('Top Fortune Holders')
    .setDescription(users.map(([id, data], i) => {
      const totalWealth = data.cash + (data.bankBalance || 0);
      return `**${i + 1}.** <@${id}> - $${totalWealth.toLocaleString()}`;
    }).join('\n'))
    .setColor(0xFFD700)
    .setTimestamp();

  await interaction.reply({ embeds: [leaderboardEmbed] });
}

async function handleStoreCommand(interaction) {
  const storeEmbed = new EmbedBuilder()
    .setTitle('Server Store')
    .setDescription('Custom server items are currently being developed.')
    .addFields(
      { name: 'Coming Soon', value: 'Server-specific items and admin features will be available in a future update', inline: false }
    )
    .setColor(0x339AF0)
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
    .setTitle('Item Added Successfully')
    .setDescription(`Added "${itemName}" to the server store.`)
    .addFields(
      { name: 'Item Name', value: itemName, inline: true },
      { name: 'Price', value: `$${itemPrice.toLocaleString()}`, inline: true },
      { name: 'Description', value: itemDescription, inline: false }
    )
    .setColor(0x51CF66)
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
  
  if (customId.startsWith('trade_select_')) {
    const targetUserId = customId.split('_')[2];
    const selectedValue = interaction.values[0];
    const userId = interaction.user.id;
    
    if (selectedValue === 'cash') {
      // Show cash amount modal
      const modal = new ModalBuilder()
        .setCustomId(`trade_cash_${targetUserId}`)
        .setTitle('Trade Cash Amount');
        
      const cashInput = new TextInputBuilder()
        .setCustomId('cash_amount')
        .setLabel('How much cash do you want to trade?')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter amount in dollars')
        .setRequired(true)
        .setMaxLength(10);
        
      const firstActionRow = new ActionRowBuilder().addComponents(cashInput);
      modal.addComponents(firstActionRow);
      
      await interaction.showModal(modal);
    } else if (selectedValue.startsWith('artefact_')) {
      const artefactIndex = parseInt(selectedValue.split('_')[1]);
      const userArtefacts = userData[userId].artefacts;
      const artefact = userArtefacts[artefactIndex];
      
      // Create confirmation for artefact trade
      const confirmButton = new ButtonBuilder()
        .setCustomId(`confirm_artefact_trade_${targetUserId}_${artefactIndex}`)
        .setLabel('Confirm Trade')
        .setStyle(ButtonStyle.Success);
        
      const cancelButton = new ButtonBuilder()
        .setCustomId('cancel_trade')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary);
        
      const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);
      
      const rarity = getRarityByArtefact(artefact);
      const confirmEmbed = new EmbedBuilder()
        .setTitle('Confirm Artefact Trade')
        .setDescription(`Do you want to trade your ${artefact}?`)
        .addFields(
          { name: 'Artefact', value: artefact, inline: true },
          { name: 'Rarity', value: rarity ? rarity.name : 'Unknown', inline: true },
          { name: 'Value', value: `$${rarity ? rarity.value.toLocaleString() : '100'}`, inline: true },
          { name: 'Trading With', value: `<@${targetUserId}>`, inline: false }
        )
        .setColor(0x339AF0)
        .setTimestamp();
        
      await interaction.update({ embeds: [confirmEmbed], components: [row] });
    }
  } else if (customId.startsWith('trade_cash_')) {
    const targetUserId = customId.split('_')[2];
    const cashAmount = parseInt(interaction.fields.getTextInputValue('cash_amount'));
    const userId = interaction.user.id;
    
    if (isNaN(cashAmount) || cashAmount <= 0) {
      const errorEmbed = new EmbedBuilder()
        .setTitle('Invalid Amount')
        .setDescription('Please enter a valid cash amount.')
        .setColor(0xFF6B6B)
        .setTimestamp();
        
      return await interaction.reply({ embeds: [errorEmbed], flags: 64 });
    }
    
    if (cashAmount > userData[userId].cash) {
      const insufficientEmbed = new EmbedBuilder()
        .setTitle('Insufficient Funds')
        .setDescription(`You only have $${userData[userId].cash.toLocaleString()} available.`)
        .setColor(0xFF6B6B)
        .setTimestamp();
        
      return await interaction.reply({ embeds: [insufficientEmbed], flags: 64 });
    }
    
    // Create confirmation for cash trade
    const confirmButton = new ButtonBuilder()
      .setCustomId(`confirm_cash_trade_${targetUserId}_${cashAmount}`)
      .setLabel('Confirm Trade')
      .setStyle(ButtonStyle.Success);
      
    const cancelButton = new ButtonBuilder()
      .setCustomId('cancel_trade')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary);
      
    const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);
    
    const confirmEmbed = new EmbedBuilder()
      .setTitle('Confirm Cash Trade')
      .setDescription(`Do you want to trade $${cashAmount.toLocaleString()}?`)
      .addFields(
        { name: 'Amount', value: `$${cashAmount.toLocaleString()}`, inline: true },
        { name: 'Trading With', value: `<@${targetUserId}>`, inline: true },
        { name: 'Remaining Cash', value: `$${(userData[userId].cash - cashAmount).toLocaleString()}`, inline: true }
      )
      .setColor(0x339AF0)
      .setTimestamp();
      
    await interaction.reply({ embeds: [confirmEmbed], components: [row] });
  } else if (customId.startsWith('confirm_cash_trade_')) {
    const parts = customId.split('_');
    const targetUserId = parts[3];
    const cashAmount = parseInt(parts[4]);
    const userId = interaction.user.id;
    
    // Execute trade
    userData[userId].cash -= cashAmount;
    userData[targetUserId].cash += cashAmount;
    saveUserData();
    
    const successEmbed = new EmbedBuilder()
      .setTitle('Trade Completed')
      .setDescription(`Successfully traded $${cashAmount.toLocaleString()} to <@${targetUserId}>`)
      .addFields(
        { name: 'Your New Balance', value: `$${userData[userId].cash.toLocaleString()}`, inline: true },
        { name: 'Trade Recipient', value: `<@${targetUserId}>`, inline: true }
      )
      .setColor(0x51CF66)
      .setTimestamp();
      
    await interaction.update({ embeds: [successEmbed], components: [] });
    
    // Notify target user
    try {
      const targetUser = await client.users.fetch(targetUserId);
      const notifyEmbed = new EmbedBuilder()
        .setTitle('Trade Received')
        .setDescription(`<@${userId}> traded you $${cashAmount.toLocaleString()}!`)
        .setColor(0x51CF66)
        .setTimestamp();
        
      await targetUser.send({ embeds: [notifyEmbed] });
    } catch (error) {
      console.log('Could not DM target user about trade');
    }
  } else if (customId.startsWith('confirm_artefact_trade_')) {
    const parts = customId.split('_');
    const targetUserId = parts[3];
    const artefactIndex = parseInt(parts[4]);
    const userId = interaction.user.id;
    
    const artefact = userData[userId].artefacts[artefactIndex];
    
    // Execute trade
    userData[userId].artefacts.splice(artefactIndex, 1);
    userData[targetUserId].artefacts.push(artefact);
    saveUserData();
    
    const rarity = getRarityByArtefact(artefact);
    const successEmbed = new EmbedBuilder()
      .setTitle('Trade Completed')
      .setDescription(`Successfully traded ${artefact} to <@${targetUserId}>`)
      .addFields(
        { name: 'Artefact', value: artefact, inline: true },
        { name: 'Rarity', value: rarity ? rarity.name : 'Unknown', inline: true },
        { name: 'Trade Recipient', value: `<@${targetUserId}>`, inline: true }
      )
      .setColor(0x51CF66)
      .setTimestamp();
      
    await interaction.update({ embeds: [successEmbed], components: [] });
    
    // Notify target user
    try {
      const targetUser = await client.users.fetch(targetUserId);
      const notifyEmbed = new EmbedBuilder()
        .setTitle('Artefact Received')
        .setDescription(`<@${userId}> traded you: ${artefact}!`)
        .addFields(
          { name: 'Artefact', value: artefact, inline: true },
          { name: 'Rarity', value: rarity ? rarity.name : 'Unknown', inline: true }
        )
        .setColor(0x51CF66)
        .setTimestamp();
        
      await targetUser.send({ embeds: [notifyEmbed] });
    } catch (error) {
      console.log('Could not DM target user about trade');
    }
  } else if (customId === 'cancel_trade') {
    const cancelEmbed = new EmbedBuilder()
      .setTitle('Trade Cancelled')
      .setDescription('The trade has been cancelled.')
      .setColor(0xFF9F43)
      .setTimestamp();
      
    await interaction.update({ embeds: [cancelEmbed], components: [] });
  } else if (customId.startsWith('marble_')) {
    const choice = customId.split('_')[1];
    const userId = interaction.user.id;
    const betAmount = parseInt(customId.split('_')[2]);
    
    // Process marble game result
    const marbleColors = ['red', 'blue', 'green', 'yellow', 'purple'];
    const actualMarble = marbleColors[Math.floor(Math.random() * marbleColors.length)];
    
    let winnings = 0;
    let result = 'lose';
    
    if (choice === actualMarble) {
      winnings = betAmount * 4; // 4x multiplier for exact match
      result = 'win';
    } else {
      winnings = -betAmount;
    }
    
    userData[userId].cash += winnings;
    saveUserData();
    
    const resultEmbed = new EmbedBuilder()
      .setTitle(result === 'win' ? 'Marble Game - You Won!' : 'Marble Game - You Lost!')
      .setDescription(`The marble was ${actualMarble}!`)
      .addFields(
        { name: 'Your Guess', value: choice, inline: true },
        { name: 'Actual Marble', value: actualMarble, inline: true },
        { name: 'Result', value: result === 'win' ? `+$${winnings.toLocaleString()}` : `${winnings.toLocaleString()}`, inline: true },
        { name: 'New Balance', value: `$${userData[userId].cash.toLocaleString()}`, inline: false }
      )
      .setColor(result === 'win' ? 0x51CF66 : 0xFF6B6B)
      .setTimestamp();
      
    await interaction.update({ embeds: [resultEmbed], components: [] });
  }
}

// Marble gambling game
async function handleMarbleCommand(interaction, userId) {
  const betAmount = interaction.options.getInteger('bet');
  
  if (userData[userId].cash < betAmount) {
    const insufficientEmbed = new EmbedBuilder()
      .setTitle('Insufficient Funds')
      .setDescription(`You need $${betAmount.toLocaleString()} to play but only have $${userData[userId].cash.toLocaleString()}.`)
      .setColor(0xFF6B6B)
      .setTimestamp();
      
    return await interaction.reply({ embeds: [insufficientEmbed] });
  }
  
  // Deduct bet amount immediately
  userData[userId].cash -= betAmount;
  saveUserData();
  
  // Create marble selection buttons
  const redButton = new ButtonBuilder()
    .setCustomId(`marble_red_${betAmount}`)
    .setLabel('Red Marble')
    .setStyle(ButtonStyle.Danger);
    
  const blueButton = new ButtonBuilder()
    .setCustomId(`marble_blue_${betAmount}`)
    .setLabel('Blue Marble')
    .setStyle(ButtonStyle.Primary);
    
  const greenButton = new ButtonBuilder()
    .setCustomId(`marble_green_${betAmount}`)
    .setLabel('Green Marble')
    .setStyle(ButtonStyle.Success);
    
  const yellowButton = new ButtonBuilder()
    .setCustomId(`marble_yellow_${betAmount}`)
    .setLabel('Yellow Marble')
    .setStyle(ButtonStyle.Secondary);
    
  const purpleButton = new ButtonBuilder()
    .setCustomId(`marble_purple_${betAmount}`)
    .setLabel('Purple Marble')
    .setStyle(ButtonStyle.Secondary);
  
  const row1 = new ActionRowBuilder().addComponents(redButton, blueButton, greenButton);
  const row2 = new ActionRowBuilder().addComponents(yellowButton, purpleButton);
  
  const marbleEmbed = new EmbedBuilder()
    .setTitle('Marble Gambling Game')
    .setDescription('Choose a marble color! If you guess correctly, you win 4x your bet!')
    .addFields(
      { name: 'Bet Amount', value: `$${betAmount.toLocaleString()}`, inline: true },
      { name: 'Potential Winnings', value: `$${(betAmount * 4).toLocaleString()}`, inline: true },
      { name: 'Instructions', value: 'Click a button to select your marble color', inline: false }
    )
    .setColor(0x9C88FF)
    .setTimestamp();
    
  await interaction.reply({ embeds: [marbleEmbed], components: [row1, row2] });
}

client.login(token);
