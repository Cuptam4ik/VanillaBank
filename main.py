# main.py
import discord
from discord.ext import commands
import os
import asyncio # Для использования asyncio.sleep
from flask import Flask, request, jsonify # For web server communication
import threading # To run Flask in a separate thread
import logging # To suppress Flask default logging

# --- КОНФИГУРАЦИЯ БОТА ---
TOKEN = os.getenv('DISCORD_TOKEN')
if not TOKEN:
    raise ValueError("Не найден токен DISCORD_TOKEN. Убедитесь, что вы создали файл .env и добавили в него DISCORD_TOKEN=ваш_токен")

TARGET_CHANNEL_ID = 1378719631853748425
TARGET_ROLE_ID = 1377644087439655153
REQUIRED_CALLER_ROLE_ID = None

# --- NEW: Configuration for Inspector Calls from Website ---
# !!! IMPORTANT: THESE ARE PLACEHOLDERS AND MUST BE CHANGED !!!
# For the "Call Inspector" feature from the website to work correctly,
# you MUST set these to the Discord Channel ID where inspector calls should go,
# and the Discord Role ID for inspectors that should be pinged.
# Using the banker's IDs here will result in inspectors being called in the banker channel
# and the banker role being pinged.
INSPECTOR_CALL_CHANNEL_ID = 1379375240366395413  # <<-- CHANGE THIS to your Inspector Call Channel ID
INSPECTOR_ROLE_ID = 1383389356592599070             # <<-- CHANGE THIS to your Inspector Role ID

# --- NEW: Secret for Bot API ---
# MUST MATCH THE SECRET IN server.js and be changed to something secure!
BOT_API_SECRET = "sk-AppXYZ-AuthToken-QWERTY12345"

# --- INTENTS SETTINGS ---
intents = discord.Intents.default()
intents.message_content = True
intents.members = True
intents.presences = True

bot = commands.Bot(command_prefix='!', intents=intents)

# --- Flask App for Web Server Communication ---
flask_app = Flask(__name__)
# Suppress Flask's default logging to keep console cleaner for bot logs
werkzeug_log = logging.getLogger('werkzeug')
werkzeug_log.setLevel(logging.ERROR)


# --- Synchronous Flask routes that schedule async Discord tasks ---
@flask_app.route('/call-banker-sync', methods=['POST'])
def handle_call_banker_sync():
    auth_header = request.headers.get('X-Bot-Api-Secret')
    if auth_header != BOT_API_SECRET:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json
    user_nickname = data.get('user_nickname', 'N/A')

    if not bot.is_ready():
        return jsonify({"error": "Bot is not ready"}), 503

    channel = bot.get_channel(TARGET_CHANNEL_ID)
    if not isinstance(channel, discord.TextChannel):
        print(f"Flask Sync Error: Banker channel not found or is not a text channel (ID: {TARGET_CHANNEL_ID})")
        return jsonify({"error": "Bot misconfiguration: Banker channel not found or is not a text channel."}), 500
        
    role = channel.guild.get_role(TARGET_ROLE_ID)
    if not role:
        print(f"Flask Sync Error: Banker role not found (ID: {TARGET_ROLE_ID})")
        return jsonify({"error": "Bot misconfiguration: Banker role not found."}), 500

    async def send_message():
        try:
            caller_mention = f"**{user_nickname}**"
            await channel.send(f"🚨 Внимание, {role.mention}! Банкир нужен на сервере! 🏦\nЗапрос от пользователя: {caller_mention}")
            print(f"Flask Sync: Successfully sent banker call message from {user_nickname}")
        except Exception as e_send:
            print(f"Flask Sync Error (send banker): {e_send}")

    bot.loop.create_task(send_message())
    return jsonify({"message": "Запрос банкиру отправлен."}), 200


@flask_app.route('/call-inspector-sync', methods=['POST'])
def handle_call_inspector_sync():
    auth_header = request.headers.get('X-Bot-Api-Secret')
    if auth_header != BOT_API_SECRET:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json
    user_nickname = data.get('user_nickname', 'N/A')

    if not bot.is_ready():
        return jsonify({"error": "Bot is not ready"}), 503

    channel = bot.get_channel(INSPECTOR_CALL_CHANNEL_ID)
    if not isinstance(channel, discord.TextChannel):
        print(f"Flask Sync Error: Inspector channel not found or is not a text channel (ID: {INSPECTOR_CALL_CHANNEL_ID})")
        return jsonify({"error": "Bot misconfiguration: Inspector channel not found or is not a text channel."}), 500
    
    role = channel.guild.get_role(INSPECTOR_ROLE_ID)
    if not role:
        print(f"Flask Sync Error: Inspector role not found (ID: {INSPECTOR_ROLE_ID})")
        return jsonify({"error": "Bot misconfiguration: Inspector role not found."}), 500

    async def send_message():
        try:
            caller_mention = f"**{user_nickname}**"
            await channel.send(f"🚨 Внимание, {role.mention}! Инспектор нужен на сервере! 📜\nЗапрос от пользователя: {caller_mention}")
            print(f"Flask Sync: Successfully sent inspector call message from {user_nickname}")
        except Exception as e_send:
            print(f"Flask Sync Error (send inspector): {e_send}")

    bot.loop.create_task(send_message())
    return jsonify({"message": "Запрос инспектору отправлен."}), 200


# --- VIEW CLASS WITH BUTTON ---
class BankerButtonView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Вызвать банкира", style=discord.ButtonStyle.primary, custom_id="call_banker_button_id")
    @commands.cooldown(1, 300, commands.BucketType.user)
    async def call_banker_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer(ephemeral=True)
        guild = interaction.guild
        user = interaction.user

        if not guild or not isinstance(user, discord.Member):
            await interaction.followup.send("Эта команда может быть использована только на сервере.", ephemeral=True)
            return

        if REQUIRED_CALLER_ROLE_ID:
            required_role = guild.get_role(REQUIRED_CALLER_ROLE_ID)
            if not required_role:
                await interaction.followup.send(f"Bot configuration error: Cannot find required role with ID {REQUIRED_CALLER_ROLE_ID}.",ephemeral=True)
                return
            if required_role not in user.roles:
                await interaction.followup.send(f"У вас нет необходимой роли ({required_role.name}) для использования этой кнопки.",ephemeral=True)
                return

        target_channel = guild.get_channel(TARGET_CHANNEL_ID)
        if not isinstance(target_channel, discord.TextChannel):
            await interaction.followup.send(f"Bot configuration error: Cannot find target text channel with ID {TARGET_CHANNEL_ID}.",ephemeral=True)
            return

        target_role = guild.get_role(TARGET_ROLE_ID)
        if not target_role:
            await interaction.followup.send(f"Bot configuration error: Cannot find target role with ID {TARGET_ROLE_ID}.",ephemeral=True)
            return
        try:
            await target_channel.send(f"Внимание, {target_role.mention}! Банкир нужен на сервере по запросу {user.mention}!")
            await interaction.followup.send(f"✅ Сообщение для {target_role.name} успешно отправлено.",ephemeral=True)
        except discord.Forbidden:
            await interaction.followup.send("У меня нет прав для отправки сообщений в целевой канал или упоминания этой роли.",ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"Произошла непредвиденная ошибка: {e}",ephemeral=True)


# --- EVENT: BOT READY ---
@bot.event
async def on_ready():
    print(f'Бот {bot.user} подключен к Discord!')
    try:
        synced = await bot.tree.sync()
        print(f"Синхронизировано {len(synced)} команд.")
    except Exception as e:
        print(f"Ошибка синхронизации команд: {e}")
    bot.add_view(BankerButtonView())
    print("Постоянное представление BankerButtonView добавлено.")
    print("Flask HTTP server запущен на порту 5001.")


# --- SLASH COMMANDS ---
@bot.tree.command(name="banker", description="Отправляет кнопку для вызова банкира.")
@commands.has_permissions(manage_channels=True)
async def call_banker_command(interaction: discord.Interaction):
    await interaction.response.send_message("Нажмите кнопку ниже, чтобы отправить запрос банкиру.",view=BankerButtonView())

@bot.tree.command(name="sync", description="Синхронизирует слэш-команды (только для владельца бота).")
@commands.is_owner()
async def sync_commands(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=True)
    try:
        synced = await bot.tree.sync()
        await interaction.followup.send(f"Синхронизировано {len(synced)} команд.")
    except Exception as e:
        await interaction.followup.send(f"Ошибка синхронизации: {e}")

# --- Error Handler for Slash Commands ---
@bot.tree.error
async def on_app_command_error(interaction: discord.Interaction, error: discord.app_commands.AppCommandError):
    if isinstance(error, commands.CommandOnCooldown):
        await interaction.response.send_message(f"Команда на перезарядке. Подождите {error.retry_after:.1f}с.",ephemeral=True)
    elif isinstance(error, commands.MissingPermissions):
        await interaction.response.send_message("У вас нет прав для этой команды.", ephemeral=True)
    else:
        print(f"Необработанная ошибка в слэш-команде: {error}")
        if not interaction.response.is_done():
            await interaction.response.send_message("Произошла неизвестная ошибка.", ephemeral=True)

# --- Flask Server Startup ---
def run_flask():
    flask_app.run(host='0.0.0.0', port=5001)

if __name__ == '__main__':
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()
    try:
        bot.run(TOKEN)
    except discord.errors.LoginFailure:
        print("Не удалось войти в Discord. Проверьте правильность токена.")
    except Exception as e:
        print(f"Ошибка при запуске бота: {e}")