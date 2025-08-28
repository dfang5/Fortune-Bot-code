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

client.once('ready', async () => {
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
      .setDescription('Sell your artefacts for cash'),
    
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
      .setDescription('View all the items that admins have added')
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

// Handle all slash command interactions
client.on('interactionCreate', async interaction => {
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
    }
  } catch (error) {
    console.error('Error handling slash command:', error);
    const errorEmbed = new EmbedBuilder()
      .setTitle('Command Error')
      .setDescription('An error occurred while processing your command. Please try again.')
      .setColor(0xFF6B6B)
      .setTimestamp();
    
    if (interaction.replied) {
      await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
    } else {
      await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
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
          '/sell - Sell your artefacts for cash',
          '/trade - Start a trade with another user'
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
        name: 'Social Features',
        value: [
          '/leaderboard - View the leaderboard and your current rating',
          '/store - View all the items that admins have added'
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
  if (!userData[userId].artefacts.length) {
    const noArtefactsEmbed = new EmbedBuilder()
      .setTitle('No Artefacts to Sell')
      .setDescription('You do not have any artefacts in your collection.')
      .addFields(
        { name: 'Suggestion', value: 'Use /scavenge to find artefacts', inline: false }
      )
      .setColor(0xFF9F43)
      .setTimestamp();
      
    return await interaction.reply({ embeds: [noArtefactsEmbed] });
  }

  let totalEarnings = 0;
  const soldItems = [];
  
  userData[userId].artefacts.forEach(artefact => {
    const rarity = getRarityByArtefact(artefact);
    if (rarity) {
      totalEarnings += rarity.sell;
      soldItems.push(`${artefact} - $${rarity.sell.toLocaleString()}`);
    }
  });
  
  userData[userId].cash += totalEarnings;
  userData[userId].artefacts = [];
  saveUserData();
  
  const sellEmbed = new EmbedBuilder()
    .setTitle('Artefacts Sold')
    .setDescription('Successfully sold your entire artefact collection.')
    .addFields(
      { name: 'Items Sold', value: soldItems.join('\n'), inline: false },
      { name: 'Total Earnings', value: `$${totalEarnings.toLocaleString()}`, inline: true },
      { name: 'New Cash Total', value: `$${userData[userId].cash.toLocaleString()}`, inline: true }
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
  
  const tradeEmbed = new EmbedBuilder()
    .setTitle('Trade System')
    .setDescription('Trading functionality is currently being developed.')
    .addFields(
      { name: 'Coming Soon', value: 'Advanced trading features will be available in a future update', inline: false }
    )
    .setColor(0x339AF0)
    .setTimestamp();
    
  await interaction.reply({ embeds: [tradeEmbed] });
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

client.login(token);
