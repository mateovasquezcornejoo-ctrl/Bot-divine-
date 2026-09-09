require('dotenv').config();
const { 
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, 
  PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, 
  ButtonStyle, StringSelectMenuBuilder, ChannelType, PermissionsBitField,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { Strategy } = require('passport-discord');
const path = require('path');
const { QuickDB } = require('quick.db');

// BASE DE DATOS LOCAL
const db = new QuickDB();

// SERVIDOR EXPRESS Y DASHBOARD WEB
const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'divine_dashboard_secret_key_2026',
  resave: false,
  saveUninitialized: false
}));

// CONFIGURACIÓN DE PASSPORT (OAuth2 DISCORD)
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new Strategy({
  clientID: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  callbackURL: process.env.CALLBACK_URL,
  scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
  process.nextTick(() => done(null, profile));
}));

app.use(passport.initialize());
app.use(passport.session());

// RUTAS DEL DASHBOARD WEB
app.get('/', (req, res) => {
  res.render('index', { user: req.user });
});

app.get('/login', passport.authenticate('discord'));

app.get('/api/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => {
  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/');
  });
});

// VISTA PRINCIPAL DEL PANEL
app.get('/dashboard', (req, res) => {
  if (!req.user) return res.redirect('/login');
  const adminGuilds = req.user.guilds.filter(g => (g.permissions & 0x8) === 0x8);
  res.render('dashboard/index', { user: req.user, guilds: adminGuilds });
});

// VISTA DE CONFIGURACIÓN POR SERVIDOR
// VISTA DE CONFIGURACIÓN POR SERVIDOR
app.get('/dashboard/:guildID', async (req, res) => {
  if (!req.user) return res.redirect('/login');
  
  const guildID = req.params.guildID;
  const userGuild = req.user.guilds.find(g => g.id === guildID);
  if (!userGuild || (userGuild.permissions & 0x8) !== 0x8) {
    return res.redirect('/dashboard');
  }

  const guild = client.guilds.cache.get(guildID);
  if (!guild) {
    return res.render('dashboard/no-bot', { guildID });
  }

  const antiRaidStatus = await db.get(`antiraid_${guildID}`) || false;
  const ticketCategory = await db.get(`ticket_cat_${guildID}`) || '';

  // 1. OBTENER LAS CATEGORÍAS DEL SERVIDOR
  const categories = guild.channels.cache.filter(c => c.type === 4 || c.type === ChannelType.GuildCategory);

  res.render('dashboard/settings', {
    user: req.user,
    guild: guild,
    antiRaidStatus,
    antiraid: antiRaidStatus,
    ticketCategory,
    categories // 2. ENVIAR LA VARIABLE A LA PLANTILLA EJS
  });
});

// POST PARA GUARDAR CONFIGURACIONES DESDE LA WEB
app.post('/dashboard/:guildID', async (req, res) => {
  if (!req.user) return res.redirect('/login');

  const guildID = req.params.guildID;
  const { antiraid, ticket_category } = req.body;

  await db.set(`antiraid_${guildID}`, antiraid === 'on');
  if (ticket_category) await db.set(`ticket_cat_${guildID}`, ticket_category);

  res.redirect(`/dashboard/${guildID}?saved=true`);
});

app.listen(PORT, () => {
  console.log(`🌐 Servidor web escuchando en el puerto ${PORT}`);
});

// CONFIGURACIÓN DEL BOT DE DISCORD
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const OWNER_ID = process.env.OWNER_ID;
const messageCooldown = new Map();

// DEFINICIÓN DE COMANDOS
const commands = [
  new SlashCommandBuilder()
    .setName('crear_canal')
    .setDescription('Crea un nuevo canal de texto o voz')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption(opt => opt.setName('nombre').setDescription('Nombre del canal').setRequired(true))
    .addStringOption(opt => opt.setName('tipo').setDescription('Tipo de canal').setRequired(true)
      .addChoices(
        { name: 'Texto', value: 'text' },
        { name: 'Voz', value: 'voice' }
      ))
    .addChannelOption(opt => opt.setName('categoria').setDescription('Categoría donde se creará').addChannelTypes(ChannelType.GuildCategory)),

  new SlashCommandBuilder()
    .setName('borrar_canal')
    .setDescription('Elimina un canal específico')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(opt => opt.setName('canal').setDescription('Canal a eliminar').setRequired(true)),

  new SlashCommandBuilder()
    .setName('crear_categoria')
    .setDescription('Crea una nueva categoría y opcionalmente un canal de texto')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption(opt => opt.setName('nombre').setDescription('Nombre de la categoría').setRequired(true))
    .addStringOption(opt => opt.setName('canal_texto').setDescription('Nombre del canal de texto opcional')),

  new SlashCommandBuilder()
    .setName('borrar_categoria')
    .setDescription('Elimina una categoría y TODOS los canales que contenga')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(opt => opt.setName('categoria').setDescription('Categoría a borrar').addChannelTypes(ChannelType.GuildCategory).setRequired(true)),

  new SlashCommandBuilder()
    .setName('cerrar_categoria')
    .setDescription('Bloquea la escritura en todos los canales de una categoría')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(opt => opt.setName('categoria').setDescription('Categoría a bloquear').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
    .addStringOption(opt => opt.setName('razon').setDescription('Razón del cierre')),

  new SlashCommandBuilder()
    .setName('crear_rol')
    .setDescription('Crea un nuevo rol en el servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addStringOption(opt => opt.setName('nombre').setDescription('Nombre del rol').setRequired(true))
    .addStringOption(opt => opt.setName('color').setDescription('Color en HEX (Ejemplo: #FF0000 o RED)')),

  new SlashCommandBuilder()
    .setName('dar_rol')
    .setDescription('Asigna un rol a un usuario')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(opt => opt.setName('usuario').setDescription('Usuario que recibirá el rol').setRequired(true))
    .addRoleOption(opt => opt.setName('rol').setDescription('Rol a asignar').setRequired(true)),

  new SlashCommandBuilder()
    .setName('dm')
    .setDescription('Enviar un mensaje directo a un usuario (Owner Override)')
    .addUserOption(opt => opt.setName('usuario').setDescription('El usuario objetivo').setRequired(true))
    .addStringOption(opt => opt.setName('mensaje').setDescription('El contenido del mensaje').setRequired(true)),

  new SlashCommandBuilder()
    .setName('on_anti_raid')
    .setDescription('Activa la proteccion Anti-Raid')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('off_anti_raid')
    .setDescription('Desactiva la proteccion Anti-Raid')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Sancionar a un usuario con silencio')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(opt => opt.setName('usuario').setDescription('Usuario a mutear').setRequired(true))
    .addIntegerOption(opt => opt.setName('tiempo').setDescription('Tiempo en minutos (Defecto = 300 min / 5 horas)'))
    .addStringOption(opt => opt.setName('razon').setDescription('Razon del mute')),

  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Retirar el mute a un usuario')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(opt => opt.setName('usuario').setDescription('Usuario a desmutear').setRequired(true)),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Advertir a un usuario')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(opt => opt.setName('usuario').setDescription('Usuario a advertir').setRequired(true))
    .addStringOption(opt => opt.setName('razon').setDescription('Razon del warn')),

  new SlashCommandBuilder()
    .setName('warns')
    .setDescription('Ver las advertencias de un usuario')
    .addUserOption(opt => opt.setName('usuario').setDescription('Usuario a consultar').setRequired(true)),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Expulsar a un usuario del servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(opt => opt.setName('usuario').setDescription('Usuario a expulsar').setRequired(true))
    .addStringOption(opt => opt.setName('razon').setDescription('Razon')),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Banear a un usuario del servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(opt => opt.setName('usuario').setDescription('Usuario a banear').setRequired(true))
    .addStringOption(opt => opt.setName('razon').setDescription('Razon')),

  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Eliminar mensajes')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(opt => opt.setName('cantidad').setDescription('Cantidad (1-100)').setRequired(true)),

  new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Ver tu saldo o el de otro usuario')
    .addUserOption(opt => opt.setName('usuario').setDescription('Usuario a consultar')),

  new SlashCommandBuilder()
    .setName('work')
    .setDescription('Trabaja para ganar dinero'),

  new SlashCommandBuilder()
    .setName('dep')
    .setDescription('Depositar dinero al banco')
    .addStringOption(opt => opt.setName('monto').setDescription('Cantidad o "all"').setRequired(true)),

  new SlashCommandBuilder()
    .setName('roulette')
    .setDescription('Apostar en la ruleta')
    .addStringOption(opt => opt.setName('monto').setDescription('Monto o "all"').setRequired(true))
    .addStringOption(opt => opt.setName('color').setDescription('Red (x2), Black (x2), Green (x14)').setRequired(true)
      .addChoices(
        { name: 'Red (Rojo)', value: 'red' },
        { name: 'Black (Negro)', value: 'black' },
        { name: 'Green (Verde)', value: 'green' }
      )),

  new SlashCommandBuilder()
    .setName('setup_tickets')
    .setDescription('Crea un panel de tickets dinámico con asignación de personal')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt => opt.setName('titulo').setDescription('Título principal del embed').setRequired(true))
    .addStringOption(opt => opt.setName('descripcion').setDescription('Descripción de instrucciones').setRequired(true))
    .addStringOption(opt => opt.setName('opciones').setDescription('Opciones separadas por "|" (Ej: 📩 Soporte | 🤝 Alianzas)').setRequired(true))
    .addStringOption(opt => opt.setName('pregunta').setDescription('Pregunta que se le hará al usuario al abrir el ticket').setRequired(true))
    .addRoleOption(opt => opt.setName('rol_atencion').setDescription('Rol encargado de ver y atender los tickets'))
    .addUserOption(opt => opt.setName('usuario_atencion').setDescription('Usuario específico encargado de ver los tickets')),

  new SlashCommandBuilder().setName('ping').setDescription('Muestra la latencia del bot'),
  new SlashCommandBuilder().setName('serverinfo').setDescription('Muestra informacion detallada del servidor'),
  new SlashCommandBuilder().setName('userinfo').setDescription('Informacion sobre ti o un usuario')
    .addUserOption(opt => opt.setName('usuario').setDescription('Usuario a consultar')),
  new SlashCommandBuilder().setName('say').setDescription('Hacer que el bot hable')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(opt => opt.setName('mensaje').setDescription('Mensaje').setRequired(true))

].map(command => command.toJSON());

// REGISTRO GLOBAL DE COMANDOS
client.once('ready', async () => {
  console.log(`🤖 DIVINE activado como: ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    console.log('🔄 Cargando todos los comandos en Discord...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('✅ ¡Todos los comandos de DIVINE cargados con éxito!');
  } catch (error) {
    console.error('❌ Error registrando comandos:', error);
  }
});
// SISTEMA ANTI-RAID
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;
  if (message.member && message.member.permissions.has(PermissionFlagsBits.Administrator)) return;

  const isAntiRaidActive = await db.get(`antiraid_${message.guild.id}`);
  if (!isAntiRaidActive) return;

  const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

  const linkRegex = /(https?:\/\/)?(www\.)?(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/.+/gi;
  if (linkRegex.test(message.content)) {
    await message.delete().catch(() => {});
    try {
      if (message.member && message.member.moderatable) {
        await message.member.timeout(FIVE_HOURS_MS, 'Anti-Raid: Envió enlaces prohibidos');
        return message.channel.send(`🚨 **ANTI-RAID:** ${message.author} ha sido muteado por **5 horas** por enviar enlaces.`)
          .then(m => setTimeout(() => m.delete().catch(() => {}), 8000));
      }
    } catch (e) {
      console.error('Error aplicando mute por link:', e);
    }
  }

  const now = Date.now();
  const userData = messageCooldown.get(message.author.id) || { count: 0, lastMessage: now };

  if (now - userData.lastMessage < 2000) {
    userData.count += 1;
    if (userData.count >= 4) {
      await message.delete().catch(() => {});
      if (userData.count === 4) {
        try {
          if (message.member && message.member.moderatable) {
            await message.member.timeout(FIVE_HOURS_MS, 'Anti-Raid: Exceso de Spam');
            message.channel.send(`🚨 **ANTI-RAID:** ${message.author} ha sido muteado por **5 horas** por hacer Spam.`)
              .then(m => setTimeout(() => m.delete().catch(() => {}), 8000));
          }
        } catch (e) {
          console.error('Error aplicando mute por spam:', e);
        }
      }
    }
  } else {
    userData.count = 1;
  }
  userData.lastMessage = now;
  messageCooldown.set(message.author.id, userData);
});

// MANEJO DE INTERACCIONES
client.on('interactionCreate', async interaction => {

  // MENÚ DE SELECCIÓN DE TICKETS
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_ticket_')) {
    const rawData = interaction.customId.replace('select_ticket_', '');
    const [encodedPregunta, rolId, userId] = rawData.split('::');
    const preguntaTexto = decodeURIComponent(encodedPregunta);
    const categoriaSeleccionada = interaction.values[0];

    const modal = new ModalBuilder()
      .setCustomId(`modal_ticket_${encodeURIComponent(categoriaSeleccionada)}::${rolId || 'none'}::${userId || 'none'}`)
      .setTitle(`Formulario de Ticket`);

    const preguntaInput = new TextInputBuilder()
      .setCustomId('respuesta_ticket')
      .setLabel(preguntaTexto.substring(0, 45))
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Escribe tu respuesta aquí...')
      .setRequired(true);

    const actionRow = new ActionRowBuilder().addComponents(preguntaInput);
    modal.addComponents(actionRow);

    await interaction.showModal(modal);
    return;
  }

  // ENVÍO DE MODAL DE TICKETS
  if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_ticket_')) {
    const rawData = interaction.customId.replace('modal_ticket_', '');
    const [encodedCategoria, rolId, userId] = rawData.split('::');
    const categoria = decodeURIComponent(encodedCategoria);
    const respuestaFormulario = interaction.fields.getTextInputValue('respuesta_ticket');

    const cleanName = categoria.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 10);
    const channelName = `ticket-${cleanName || 'general'}-${interaction.user.username.toLowerCase()}`.substring(0, 30);

    const existingChannel = interaction.guild.channels.cache.find(c => c.name.includes(interaction.user.username.toLowerCase()));
    if (existingChannel) {
      return interaction.reply({ content: `⚠️ Ya tienes un ticket abierto en ${existingChannel}.`, flags: 64 });
    }

    const permissionOverwrites = [
      { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
      { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
    ];

    if (rolId && rolId !== 'none') {
      permissionOverwrites.push({
        id: rolId,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
      });
    }

    if (userId && userId !== 'none') {
      permissionOverwrites.push({
        id: userId,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
      });
    }

    const parentCat = await db.get(`ticket_cat_${interaction.guild.id}`);

    const ticketChannel = await interaction.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: parentCat || null,
      permissionOverwrites: permissionOverwrites
    });

    const closeButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('close_ticket')
        .setLabel('Cerrar Ticket 🔒')
        .setStyle(ButtonStyle.Danger)
    );

    const embedTicket = new EmbedBuilder()
      .setTitle(`🎟️ Creado: ${categoria}`)
      .setDescription(`**Respuesta del usuario:**\n>>> ${respuestaFormulario}`)
      .setColor(0x5865F2)
      .setFooter({ text: `Ticket abierto por ${interaction.user.tag}` })
      .setTimestamp();

    let pingStaff = '';
    if (rolId && rolId !== 'none') pingStaff += ` <@&${rolId}>`;
    if (userId && userId !== 'none') pingStaff += ` <@${userId}>`;

    await ticketChannel.send({ 
      content: `Bienvenido/a ${interaction.user}.${pingStaff ? ` Mención para el personal:${pingStaff}` : ''}`,
      embeds: [embedTicket],
      components: [closeButton]
    });

    await interaction.reply({ content: `✅ Tu ticket ha sido creado correctamente en ${ticketChannel}.`, flags: 64 });
    return;
  }

  // BOTÓN CERRAR TICKET
  if (interaction.isButton() && interaction.customId === 'close_ticket') {
    await interaction.reply('🔒 El ticket se cerrará en 5 segundos...');
    setTimeout(() => {
      interaction.channel.delete().catch(() => {});
    }, 5000);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName, options } = interaction;

  // ANTI-RAID
  if (commandName === 'on_anti_raid') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ No tienes permisos de administrador.', flags: 64 });
    }
    await db.set(`antiraid_${interaction.guild.id}`, true);
    await interaction.reply('🛡️ El sistema **Anti-Raid** ha sido **activado**.');
  }

  else if (commandName === 'off_anti_raid') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ No tienes permisos de administrador.', flags: 64 });
    }
    await db.set(`antiraid_${interaction.guild.id}`, false);
    await interaction.reply('⚠️ El sistema **Anti-Raid** ha sido **desactivado**.');
  }

  // MODERACIÓN
  else if (commandName === 'warn') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply({ content: '❌ No tienes permiso para advertir usuarios.', flags: 64 });
    }
    const target = options.getUser('usuario');
    const reason = options.getString('razon') || 'Sin razón especificada';
    
    await db.add(`warns_${interaction.guild.id}_${target.id}`, 1);
    const totalWarns = await db.get(`warns_${interaction.guild.id}_${target.id}`);
    
    await interaction.reply(`⚠️ **${target.tag}** ha sido advertido. Razón: ${reason}. Total de advertencias: **${totalWarns}**.`);
  }

  else if (commandName === 'warns') {
    const target = options.getUser('usuario');
    const totalWarns = await db.get(`warns_${interaction.guild.id}_${target.id}`) || 0;
    await interaction.reply(`📋 El usuario **${target.tag}** tiene **${totalWarns}** advertencia(s).`);
  }

  else if (commandName === 'kick') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
      return interaction.reply({ content: '❌ No tienes permiso para expulsar miembros.', flags: 64 });
    }
    const member = options.getMember('usuario');
    const reason = options.getString('razon') || 'Sin razón especificada';
    if (!member) return interaction.reply({ content: '❌ Usuario no encontrado.', flags: 64 });
    
    await member.kick(reason);
    await interaction.reply(`👢 **${member.user.tag}** fue expulsado. Razón: ${reason}`);
  }

  else if (commandName === 'ban') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
      return interaction.reply({ content: '❌ No tienes permiso para banear miembros.', flags: 64 });
    }
    const user = options.getUser('usuario');
    const reason = options.getString('razon') || 'Sin razón especificada';
    
    await interaction.guild.members.ban(user, { reason });
    await interaction.reply(`🔨 **${user.tag}** ha sido baneado. Razón: ${reason}`);
  }

  else if (commandName === 'clear') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply({ content: '❌ No tienes permiso para borrar mensajes.', flags: 64 });
    }
    const cantidad = options.getInteger('cantidad');
    if (cantidad < 1 || cantidad > 100) {
      return interaction.reply({ content: '❌ Debes ingresar un número entre 1 y 100.', flags: 64 });
    }
    
    const deleted = await interaction.channel.bulkDelete(cantidad, true);
    await interaction.reply({ content: `🧹 Se han borrado **${deleted.size}** mensajes.`, flags: 64 });
  }
  else if (commandName === 'mute') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return interaction.reply({ content: '❌ No tienes permisos para mutear miembros.', flags: 64 });
    }
    const member = options.getMember('usuario');
    const tiempo = options.getInteger('tiempo') || 300;
    const razon = options.getString('razon') || 'Sin razón especificada';

    if (!member || !member.moderatable) {
      return interaction.reply({ content: '❌ No puedo mutear a este usuario.', flags: 64 });
    }

    await member.timeout(tiempo * 60 * 1000, razon);
    await interaction.reply(`🔇 **${member.user.tag}** ha sido muteado por **${tiempo} minutos**. Razón: ${razon}`);
  }

  else if (commandName === 'unmute') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return interaction.reply({ content: '❌ No tienes permisos para desmutear miembros.', flags: 64 });
    }
    const member = options.getMember('usuario');

    if (!member) return interaction.reply({ content: '❌ Usuario no encontrado.', flags: 64 });

    await member.timeout(null);
    await interaction.reply(`🔊 Se le ha retirado el mute a **${member.user.tag}**.`);
  }

  // ECONOMÍA
  else if (commandName === 'balance') {
    const user = options.getUser('usuario') || interaction.user;
    const pocket = await db.get(`money_${interaction.guild.id}_${user.id}`) || 0;
    const bank = await db.get(`bank_${interaction.guild.id}_${user.id}`) || 0;
    
    await interaction.reply(`💰 **Balance de ${user.username}:**\n💵 **Bolsillo:** $${pocket}\n🏦 **Banco:** $${bank}\n🪙 **Total:** $${pocket + bank}`);
  }

  else if (commandName === 'work') {
    const earned = Math.floor(Math.random() * 200) + 50;
    await db.add(`money_${interaction.guild.id}_${interaction.user.id}`, earned);
    await interaction.reply(`💼 Trabajaste duro y ganaste **$${earned}**.`);
  }

  else if (commandName === 'dep') {
    const montoInput = options.getString('monto');
    const pocket = await db.get(`money_${interaction.guild.id}_${interaction.user.id}`) || 0;
    let amount = parseInt(montoInput);

    if (montoInput.toLowerCase() === 'all') amount = pocket;

    if (isNaN(amount) || amount <= 0 || amount > pocket) {
      return interaction.reply({ content: '❌ No tienes suficiente dinero en el bolsillo o ingresaste un monto inválido.', flags: 64 });
    }
    
    await db.sub(`money_${interaction.guild.id}_${interaction.user.id}`, amount);
    await db.add(`bank_${interaction.guild.id}_${interaction.user.id}`, amount);
    await interaction.reply(`🏦 Depositaste **$${amount}** en tu banco.`);
  }

  else if (commandName === 'roulette') {
    const montoInput = options.getString('monto');
    const color = options.getString('color').toLowerCase();
    const pocket = await db.get(`money_${interaction.guild.id}_${interaction.user.id}`) || 0;
    let bet = parseInt(montoInput);

    if (montoInput.toLowerCase() === 'all') bet = pocket;

    if (isNaN(bet) || bet <= 0 || bet > pocket) {
      return interaction.reply({ content: '❌ No tienes suficiente dinero para apostar esa cantidad.', flags: 64 });
    }
    
    const random = Math.floor(Math.random() * 37);
    let resultColor = 'black';
    if (random === 0) resultColor = 'green';
    else if (random % 2 === 0) resultColor = 'red';
    
    if (color === resultColor) {
      const winAmount = color === 'green' ? bet * 14 : bet * 2;
      await db.add(`money_${interaction.guild.id}_${interaction.user.id}`, winAmount);
      await interaction.reply(`🎰 Cayó en **${resultColor.toUpperCase()} (${random})**. ¡Ganaste **$${winAmount}**!`);
    } else {
      await db.sub(`money_${interaction.guild.id}_${interaction.user.id}`, bet);
      await interaction.reply(`🎰 Cayó en **${resultColor.toUpperCase()} (${random})**. Perdiste **$${bet}**.`);
    }
  }

  // COMANDOS DE CANALES Y CATEGORÍAS
  else if (commandName === 'crear_canal') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ content: '❌ No tienes permisos para administrar canales.', flags: 64 });
    }

    const nombre = options.getString('nombre');
    const tipoStr = options.getString('tipo');
    const categoria = options.getChannel('categoria');

    const tipoCanal = tipoStr === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;

    try {
      const nuevoCanal = await interaction.guild.channels.create({
        name: nombre,
        type: tipoCanal,
        parent: categoria ? categoria.id : null
      });

      await interaction.reply({ content: `✅ Canal ${nuevoCanal} creado correctamente.`, flags: 64 });
    } catch (error) {
      console.error(error);
      await interaction.reply({ content: '❌ Error al crear el canal.', flags: 64 });
    }
  }

  else if (commandName === 'borrar_canal') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ content: '❌ No tienes permisos para administrar canales.', flags: 64 });
    }

    const canal = options.getChannel('canal');

    try {
      const nombreCanal = canal.name;
      await canal.delete();
      await interaction.reply({ content: `🗑️ El canal **#${nombreCanal}** ha sido eliminado.`, flags: 64 });
    } catch (error) {
      console.error(error);
      await interaction.reply({ content: '❌ No se pudo eliminar el canal.', flags: 64 });
    }
  }
  else if (commandName === 'crear_categoria') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ content: '❌ No tienes permisos para administrar canales.', flags: 64 });
    }

    const nombreCat = options.getString('nombre');
    const canalTexto = options.getString('canal_texto');

    await interaction.deferReply({ flags: 64 });

    try {
      const categoria = await interaction.guild.channels.create({
        name: nombreCat,
        type: ChannelType.GuildCategory
      });

      if (canalTexto) {
        await interaction.guild.channels.create({
          name: canalTexto,
          type: ChannelType.GuildText,
          parent: categoria.id
        });
      }

      await interaction.editReply({
        content: `📁 **Categoría "${categoria.name}" creada con éxito.**${canalTexto ? ` Se incluyó el canal #${canalTexto}.` : ''}`
      });
    } catch (error) {
      console.error(error);
      await interaction.editReply({ content: '❌ Ocurrió un error al intentar crear la categoría.' });
    }
  }

  else if (commandName === 'borrar_categoria') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ content: '❌ No tienes permisos para administrar canales.', flags: 64 });
    }

    const categoria = options.getChannel('categoria');

    await interaction.deferReply({ flags: 64 });

    try {
      const canalesHijos = interaction.guild.channels.cache.filter(c => c.parentId === categoria.id);

      let borrados = 0;
      for (const [id, canal] of canalesHijos) {
        await canal.delete('Eliminación por comando /borrar_categoria').catch(() => {});
        borrados++;
      }

      const nombreCat = categoria.name;
      await categoria.delete('Eliminación por comando /borrar_categoria').catch(() => {});

      await interaction.editReply({
        content: `🗑️ **Categoría "${nombreCat}" y sus ${borrados} canales fueron eliminados correctamente.**`
      });
    } catch (error) {
      console.error(error);
      await interaction.editReply({ content: '❌ Ocurrió un error al intentar eliminar la categoría.' });
    }
  }

  else if (commandName === 'cerrar_categoria') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ content: '❌ No tienes permisos para administrar canales.', flags: 64 });
    }

    const categoria = options.getChannel('categoria');
    const razon = options.getString('razon') || 'Cierre de categoría';

    await interaction.deferReply({ flags: 64 });

    try {
      const canalesHijos = interaction.guild.channels.cache.filter(c => c.parentId === categoria.id);

      for (const [id, canal] of canalesHijos) {
        await canal.permissionOverwrites.edit(interaction.guild.roles.everyone, {
          SendMessages: false
        }, { reason });
      }

      await interaction.editReply({ content: `🔒 La categoría **"${categoria.name}"** ha sido bloqueada.` });
    } catch (error) {
      console.error(error);
      await interaction.editReply({ content: '❌ Error al intentar bloquear la categoría.' });
    }
  }

  // ROLES
  else if (commandName === 'crear_rol') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: '❌ No tienes permisos para administrar roles.', flags: 64 });
    }

    const nombre = options.getString('nombre');
    const color = options.getString('color') || '#99AAB5';

    try {
      const nuevoRol = await interaction.guild.roles.create({
        name: nombre,
        color: color,
        reason: 'Creado mediante comando /crear_rol'
      });

      await interaction.reply({ content: `🎨 Rol ${nuevoRol} creado con éxito.`, flags: 64 });
    } catch (error) {
      console.error(error);
      await interaction.reply({ content: '❌ Error al crear el rol.', flags: 64 });
    }
  }
  else if (commandName === 'dar_rol') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: '❌ No tienes permisos para administrar roles.', flags: 64 });
    }

    const member = options.getMember('usuario');
    const rol = options.getRole('rol');

    if (!member) {
      return interaction.reply({ content: '❌ Usuario no encontrado en este servidor.', flags: 64 });
    }

    try {
      await member.roles.add(rol);
      await interaction.reply({ content: `✅ Se ha otorgado el rol **${rol.name}** a **${member.user.tag}**.`, flags: 64 });
    } catch (error) {
      console.error(error);
      await interaction.reply({ content: '❌ No pude asignar el rol. Revisa la jerarquía de roles del bot.', flags: 64 });
    }
  }

  // DM OVERRIDE
  else if (commandName === 'dm') {
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({ content: '❌ Este comando está reservado exclusivamente para el dueño del bot.', flags: 64 });
    }

    const targetUser = options.getUser('usuario');
    const mensajeTexto = options.getString('mensaje');

    try {
      await targetUser.send(mensajeTexto);
      await interaction.reply({ content: `📩 Mensaje enviado con éxito a **${targetUser.tag}**.`, flags: 64 });
    } catch (error) {
      console.error(error);
      await interaction.reply({ content: `❌ No se pudo enviar el mensaje a **${targetUser.tag}**. Es posible que tenga los MD cerrados.`, flags: 64 });
    }
  }

  // SETUP TICKETS
  else if (commandName === 'setup_tickets') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ No tienes permisos de administrador para ejecutar este comando.', flags: 64 });
    }

    const titulo = options.getString('titulo');
    const descripcion = options.getString('descripcion');
    const opcionesRaw = options.getString('opciones');
    const pregunta = options.getString('pregunta');
    const rolAtencion = options.getRole('rol_atencion');
    const usuarioAtencion = options.getUser('usuario_atencion');

    const opcionesArray = opcionesRaw.split('|').map(o => o.trim()).filter(o => o.length > 0);

    if (opcionesArray.length === 0) {
      return interaction.reply({ content: '❌ Debes ingresar al menos una opción válida.', flags: 64 });
    }

    const selectOptions = opcionesArray.map((op, idx) => ({
      label: op.substring(0, 100),
      value: op.substring(0, 100),
      description: `Abrir ticket de ${op}`.substring(0, 100)
    }));

    const encodedPregunta = encodeURIComponent(pregunta);
    const rolId = rolAtencion ? rolAtencion.id : 'none';
    const userId = usuarioAtencion ? usuarioAtencion.id : 'none';

    const customId = `select_ticket_${encodedPregunta}::${rolId}::${userId}`;

    const menu = new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('Selecciona una opción para abrir un ticket...')
      .addOptions(selectOptions);

    const row = new ActionRowBuilder().addComponents(menu);

    const embed = new EmbedBuilder()
      .setTitle(titulo)
      .setDescription(descripcion)
      .setColor(0x5865F2)
      .setFooter({ text: 'Selecciona una opción abajo para ser atendido' });

    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: '✅ Panel de tickets creado con éxito.', flags: 64 });
  }
  // INFORMACIÓN Y UTILIDAD
  else if (commandName === 'ping') {
    await interaction.reply(`🏓 Pong! Latencia del bot: **${client.ws.ping}ms**`);
  }

  else if (commandName === 'serverinfo') {
    const { guild } = interaction;
    const embed = new EmbedBuilder()
      .setTitle(`Información de ${guild.name}`)
      .setThumbnail(guild.iconURL({ dynamic: true }))
      .addFields(
        { name: '🆔 ID', value: guild.id, inline: true },
        { name: '👑 Dueño', value: `<@${guild.ownerId}>`, inline: true },
        { name: '👥 Miembros', value: `${guild.memberCount}`, inline: true },
        { name: '📁 Canales', value: `${guild.channels.cache.size}`, inline: true },
        { name: '🎨 Roles', value: `${guild.roles.cache.size}`, inline: true }
      )
      .setColor(0x5865F2);

    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'userinfo') {
    const user = options.getUser('usuario') || interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    const embed = new EmbedBuilder()
      .setTitle(`Información de ${user.tag}`)
      .setThumbnail(user.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: '🆔 ID', value: user.id, inline: true },
        { name: '📅 Cuenta Creada', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: '📥 Unió al Servidor', value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'N/A', inline: true }
      )
      .setColor(0x5865F2);

    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'say') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply({ content: '❌ No tienes permisos para usar este comando.', flags: 64 });
    }

    const mensaje = options.getString('mensaje');
    await interaction.channel.send(mensaje);
    await interaction.reply({ content: '✅ Mensaje enviado.', flags: 64 });
  }
});

// INICIO DE SESIÓN DEL BOT
client.login(process.env.DISCORD_TOKEN);