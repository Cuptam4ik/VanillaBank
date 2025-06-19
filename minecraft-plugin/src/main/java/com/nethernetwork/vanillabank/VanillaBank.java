package com.nethernetwork.vanillabank;

import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitRunnable;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Scanner;

public class VanillaBank extends JavaPlugin implements CommandExecutor {

    private final String apiUrl = "https://cuptam4ik.ru/api/generateRegToken";

    @Override
    public void onEnable() {
        // Регистрация команды
        this.getCommand("register").setExecutor(this);
        getLogger().info("VanillaBank plugin has been enabled!");
    }

    @Override
    public void onDisable() {
        getLogger().info("VanillaBank plugin has been disabled.");
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        // Проверяем, что команду выполняет игрок
        if (!(sender instanceof Player)) {
            sender.sendMessage("This command can only be run by a player.");
            return true;
        }

        Player player = (Player) sender;
        String nickname = player.getName();

        // Отправляем асинхронный запрос, чтобы не блокировать основной поток сервера
        new BukkitRunnable() {
            @Override
            public void run() {
                try {
                    // Создаем URL и открываем соединение
                    URL url = new URL(apiUrl);
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Content-Type", "application/json; utf-8");
                    conn.setRequestProperty("Accept", "application/json");
                    conn.setDoOutput(true);

                    // Формируем тело запроса (JSON)
                    String jsonInputString = "{\"nickname\": \"" + nickname + "\"}";

                    // Отправляем данные
                    try (OutputStream os = conn.getOutputStream()) {
                        byte[] input = jsonInputString.getBytes(StandardCharsets.UTF_8);
                        os.write(input, 0, input.length);
                    }

                    int responseCode = conn.getResponseCode();

                    // Обрабатываем ответ от сервера
                    if (responseCode == HttpURLConnection.HTTP_OK) {
                        // Читаем успешный ответ
                        Scanner scanner = new Scanner(conn.getInputStream(), StandardCharsets.UTF_8.name());
                        String responseBody = scanner.useDelimiter("\\A").next();
                        scanner.close();
                        
                        // Извлекаем ссылку из JSON ответа
                        // Простая реализация, для более надежной стоит использовать JSON библиотеку (например, Gson)
                        String link = responseBody.split("\"registrationLink\":\"")[1].split("\"")[0];

                        player.sendMessage("§a[VB] Ссылка для регистрации: §e" + link);
                        player.sendMessage("§a[VB] §7Перейдите по ней в браузере, чтобы завершить регистрацию.");

                    } else {
                        // Читаем сообщение об ошибке
                        Scanner scanner = new Scanner(conn.getErrorStream(), StandardCharsets.UTF_8.name());
                        String errorBody = scanner.useDelimiter("\\A").next();
                        scanner.close();
                        
                        String errorMessage = "An unknown error occurred.";
                        if(errorBody != null && !errorBody.isEmpty()){
                           try {
                               errorMessage = errorBody.split("\"message\":\"")[1].split("\"")[0];
                           } catch (ArrayIndexOutOfBoundsException ex) {
                               getLogger().warning("Failed to parse JSON error from API. Raw response: " + errorBody);
                               errorMessage = "Received an unexpected response from the server.";
                           }
                        }
                        
                        player.sendMessage("§c[VB] Ошибка регистрации: " + errorMessage);
                    }
                    conn.disconnect();
                } catch (Exception e) {
                    player.sendMessage("§c[VB] Произошла внутренняя ошибка при попытке регистрации.");
                    getLogger().severe("Could not connect to the web API: " + e.getMessage());
                    e.printStackTrace();
                }
            }
        }.runTaskAsynchronously(this);

        return true;
    }
} 