# main.py
import discord
from discord.ext import commands
import os
import asyncio # Для использования asyncio.sleep
from flask import Flask, request, jsonify # For web server communication
import threading # To run Flask in a separate thread
import logging # To suppress Flask default logging

# --- КОНФИГУРАЦИЯ БОТА ---
TOKEN = '' # Unchanged
TARGET_CHANNEL_ID = 1378719631853748425 # Unchanged (for banker button in Discord)
TARGET_ROLE_ID = 1377644087439655153    # Unchanged (for banker button in Discord)
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
    caller_id_str = data.get('caller_id', 'N/A') # This is the website User.id (string)

    if not bot.is_ready():
        return jsonify({"error": "Bot is not ready"}), 503

    banker_target_channel = bot.get_channel(TARGET_CHANNEL_ID) # Banker's specific channel
    banker_target_role = None
    guild = None

    if banker_target_channel:
        guild = banker_target_channel.guild
        if guild: banker_target_role = guild.get_role(TARGET_ROLE_ID) # Banker's specific role

    if not banker_target_channel or not banker_target_role:
        print(f"Flask Sync Error: Banker channel/role not found (Channel: {TARGET_CHANNEL_ID}, Role: {TARGET_ROLE_ID})")
        return jsonify({"error": "Bot misconfiguration: Banker channel or role not found."}), 500

    async def send_message():
        caller_mention = f"**{user_nickname}**" # Fallback to nickname
        if guild and caller_id_str != 'N/A':
            try:
                member = await guild.fetch_member(int(caller_id_str)) # Try to fetch by ID
                if member: caller_mention = f"{member.mention} (Сайт: **{user_nickname}**)"
            except (discord.NotFound, ValueError, AttributeError):
                # If not found, or ID is not a valid Discord ID, or guild is None
                pass # Keep using nickname
        try:
            await banker_target_channel.send(f"🚨 Внимание, {banker_target_role.mention}! Банкир нужен на сервере! 🏦\nЗапрос от пользователя: {caller_mention}")
            print(f"Flask Sync: Successfully sent banker call message from {user_nickname}")
        except Exception as e_send:
            print(f"Flask Sync Error (send banker): {e_send}")
            # Cannot return HTTP response from here as it's in a scheduled task

    bot.loop.create_task(send_message())
    return jsonify({"message": "Запрос банкиру отправлен."}), 200


@flask_app.route('/call-inspector-sync', methods=['POST'])
def handle_call_inspector_sync():
    auth_header = request.headers.get('X-Bot-Api-Secret')
    if auth_header != BOT_API_SECRET:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json
    user_nickname = data.get('user_nickname', 'N/A')
    caller_id_str = data.get('caller_id', 'N/A') # Website User.id

    if not bot.is_ready():
        return jsonify({"error": "Bot is not ready"}), 503

    inspector_target_channel = bot.get_channel(INSPECTOR_CALL_CHANNEL_ID) # Inspector's channel
    inspector_target_role = None
    guild = None

    if inspector_target_channel:
        guild = inspector_target_channel.guild
        if guild: inspector_target_role = guild.get_role(INSPECTOR_ROLE_ID) # Inspector's role

    if not inspector_target_channel or not inspector_target_role:
        print(f"Flask Sync Error: Inspector channel/role not found (Channel: {INSPECTOR_CALL_CHANNEL_ID}, Role: {INSPECTOR_ROLE_ID})")
        return jsonify({"error": "Bot misconfiguration: Inspector channel or role not found. Please check IDs in bot code."}), 500

    async def send_message():
        caller_mention = f"**{user_nickname}**"
        if guild and caller_id_str != 'N/A':
            try:
                member = await guild.fetch_member(int(caller_id_str))
                if member: caller_mention = f"{member.mention} (Сайт: **{user_nickname}**)"
            except (discord.NotFound, ValueError, AttributeError):
                pass
        try:
            await inspector_target_channel.send(f"🚨 Внимание, {inspector_target_role.mention}! Инспектор нужен на сервере! 📜\nЗапрос от пользователя: {caller_mention}")
            print(f"Flask Sync: Successfully sent inspector call message from {user_nickname}")
        except Exception as e_send:
            print(f"Flask Sync Error (send inspector): {e_send}")

    bot.loop.create_task(send_message())
    return jsonify({"message": "Запрос инспектору отправлен."}), 200


# --- VIEW CLASS WITH BUTTON (Unchanged from your original) ---
class BankerButtonView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Вызвать банкира", style=discord.ButtonStyle.primary, custom_id="call_banker_button_id")
    @commands.cooldown(1, 300, commands.BucketType.user)
    async def call_banker_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer(ephemeral=True)
        guild = interaction.guild
        if not guild:
            await interaction.followup.send("This command can only be used on a server.", ephemeral=True)
            return

        if REQUIRED_CALLER_ROLE_ID:
            required_role = guild.get_role(REQUIRED_CALLER_ROLE_ID)
            if not required_role:
                await interaction.followup.send(
                    f"Bot configuration: Could not find the required role for calling with ID `{REQUIRED_CALLER_ROLE_ID}`.",
                    ephemeral=True
                )
                print(f"Error: Could not find the required role for calling with ID {REQUIRED_CALLER_ROLE_ID}")
                return
            if required_role not in interaction.user.roles:
                await interaction.followup.send(
                    f"You do not have the necessary role ({required_role.name}) to use this button.",
                    ephemeral=True
                )
                return

        target_channel = guild.get_channel(TARGET_CHANNEL_ID)
        if not target_channel:
            await interaction.followup.send(
                f"Error: Could not find the target channel with ID `{TARGET_CHANNEL_ID}`.",
                ephemeral=True
            )
            print(f"Error: Could not find channel with ID {TARGET_CHANNEL_ID}")
            return
        target_role = guild.get_role(TARGET_ROLE_ID)
        if not target_role:
            await interaction.followup.send(
                f"Error: Could not find the target role with ID `{TARGET_ROLE_ID}`.",
                ephemeral=True
            )
            print(f"Error: Could not find role with ID {TARGET_ROLE_ID}")
            return
        try:
            await target_channel.send(f"Внимание, {target_role.mention}! Банкир нужен на сервере по запросу {interaction.user.mention}!")
            await interaction.followup.send(
                f"✅ Сообщение для {target_role.name} успешно отправлено в канал {target_channel.name}. Скоро с вами свяжутся!",
                ephemeral=True
            )
            print(f"Successfully sent message to channel {target_channel.name} mentioning role {target_role.name}")
        except discord.Forbidden:
            await interaction.followup.send(
                "У меня нет прав для отправки сообщений в целевой канал или упоминания этой роли.",
                ephemeral=True
            )
            print(f"Error: Bot does not have permissions to send messages to channel {target_channel.name} or mention role {target_role.name}")
        except Exception as e:
            await interaction.followup.send(
                f"Произошла непредвиденная ошибка при отправке сообщения: {e}",
                ephemeral=True
            )
            print(f"Unknown error: {e}")

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        try:
            if isinstance(interaction.data, dict) and interaction.data.get('custom_id') == "call_banker_button_id":
                pass
            return True
        except commands.CommandOnCooldown as e:
            await interaction.response.send_message(
                f"Пожалуйста, подождите {e.retry_after:.0f} секунд, прежде чем снова нажимать эту кнопку.",
                ephemeral=True
            )
            return False
        except Exception as e:
            print(f"Error in interaction_check: {e}")
            return True


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
    print("Flask HTTP server для вызовов с сайта запущен на порту 5001 в отдельном потоке.")


# --- SLASH COMMAND TO SEND THE BUTTON (Unchanged) ---
@bot.tree.command(name="banker", description="Отправляет кнопку для вызова банкира.")
@commands.has_permissions(manage_channels=True)
async def call_banker_command(interaction: discord.Interaction):
    await interaction.response.send_message(
        "Нажмите кнопку ниже, чтобы отправить запрос банкиру. Пожалуйста, не спамьте!",
        view=BankerButtonView()
    )

# --- SLASH COMMAND TO SYNC (Unchanged) ---
@bot.tree.command(name="sync", description="Синхронизирует слэш-команды (только для владельца бота).")
@commands.is_owner()
async def sync_commands(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=True)
    try:
        synced = await bot.tree.sync()
        await interaction.followup.send(f"Глобальные команды синхронизированы: {len(synced)} команд.", ephemeral=True)
        print(f"Владелец {interaction.user} синхронизировал {len(synced)} глобальных команд.")
    except Exception as e:
        await interaction.followup.send(f"Ошибка синхронизации команд: {e}", ephemeral=True)
        print(f"Ошибка синхронизации команд (владелец): {e}")


# --- Error handler for slash commands (Unchanged) ---
@bot.tree.error
async def on_app_command_error(interaction: discord.Interaction, error: discord.app_commands.AppCommandError):
    if isinstance(error, commands.MissingPermissions):
        await interaction.response.send_message(
            "У вас нет разрешения на использование этой команды.",
            ephemeral=True
        )
    elif isinstance(error, commands.CommandOnCooldown):
        await interaction.response.send_message(
            f"Эта команда находится на кулдауне. Пожалуйста, подождите {error.retry_after:.0f} секунд.",
            ephemeral=True
        )
    elif isinstance(error, commands.NotOwner):
        await interaction.response.send_message(
            "У вас нет разрешения на использование этой команды. Она доступна только владельцу бота.",
            ephemeral=True
        )
    else:
        await interaction.response.send_message(
            f"Произошла ошибка при выполнении команды: {error}",
            ephemeral=True
        )
        print(f"Ошибка слэш-команды: {error}")


# --- START THE BOT ---
if __name__ == "__main__":
    # Start Flask in a separate thread.
    # daemon=True ensures the thread exits when the main program (bot) exits.
    flask_thread = threading.Thread(target=lambda: flask_app.run(host='0.0.0.0', port=5001), daemon=True)
    flask_thread.start()

    bot.run(TOKEN)