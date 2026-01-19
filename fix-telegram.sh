#!/bin/bash

# Telegram修复脚本 - 重启ngrok和重新注册webhook
# Fix Telegram Script - Restart ngrok and re-register webhook

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$PROJECT_DIR/.env"

echo "🔧 Telegram Remote Control 修复脚本"
echo "📁 项目目录: $PROJECT_DIR"

# 检查.env文件
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ .env文件不存在: $ENV_FILE"
    exit 1
fi

# 加载环境变量
source "$ENV_FILE"

if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
    echo "❌ TELEGRAM_BOT_TOKEN未设置"
    exit 1
fi

if [ -z "$NGROK_DOMAIN" ]; then
    echo "❌ NGROK_DOMAIN未设置"
    exit 1
fi

# 停止旧的ngrok进程
echo "🔄 停止旧的ngrok进程..."
pkill -f "ngrok http" || true
sleep 2

# 启动新的ngrok隧道
echo "🚀 启动ngrok隧道..."
nohup ngrok http 4731 --url="$NGROK_DOMAIN" > /dev/null 2>&1 &
sleep 5

# 验证ngrok启动
echo "🔍 验证ngrok..."
for i in {1..10}; do
    if curl -s http://localhost:4040/api/tunnels | jq -e '.tunnels[0]' > /dev/null 2>&1; then
        echo "✅ ngrok已启动"
        break
    fi
    echo "等待ngrok启动... ($i/10)"
    sleep 2
done

WEBHOOK_URL="https://$NGROK_DOMAIN"

# 设置新的webhook
echo "🔗 设置Telegram webhook..."
WEBHOOK_ENDPOINT="$WEBHOOK_URL/webhook/telegram"
RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
    -H "Content-Type: application/json" \
    -d "{\"url\": \"$WEBHOOK_ENDPOINT\", \"allowed_updates\": [\"message\", \"callback_query\"]}")

if echo "$RESPONSE" | grep -q '"ok":true'; then
    echo "✅ Webhook设置成功: $WEBHOOK_ENDPOINT"
else
    echo "❌ Webhook设置失败: $RESPONSE"
    exit 1
fi

# 验证webhook状态
echo "🔍 验证webhook状态..."
WEBHOOK_INFO=$(curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo")
echo "📊 Webhook信息: $WEBHOOK_INFO"

# 测试健康检查
echo "🏥 测试健康检查..."
HEALTH_RESPONSE=$(curl -s "$WEBHOOK_URL/health" || echo "failed")
if echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
    echo "✅ 健康检查通过"
else
    echo "⚠️  健康检查失败，请确保webhook服务正在运行"
    echo "运行: node start-telegram-webhook.js"
fi

echo ""
echo "🎉 修复完成！"
echo "📱 Webhook URL: $WEBHOOK_ENDPOINT"
echo "🧪 发送测试消息..."

# 发送测试消息
CHAT_TARGET="$TELEGRAM_GROUP_ID"
if [ -z "$CHAT_TARGET" ]; then
    CHAT_TARGET="$TELEGRAM_CHAT_ID"
fi

if [ -n "$CHAT_TARGET" ]; then
    curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
        -H "Content-Type: application/json" \
        -d "{\"chat_id\": $CHAT_TARGET, \"text\": \"🎉 Telegram Remote Control已修复！\\n\\nWebhook: $WEBHOOK_ENDPOINT\"}" > /dev/null
    echo "✅ 测试消息已发送到Telegram (Chat ID: $CHAT_TARGET)"
else
    echo "⚠️  未配置Telegram Chat ID或Group ID"
fi

echo ""
echo "🔥 下一步："
echo "1️⃣  确保webhook服务正在运行: node start-telegram-webhook.js"
echo "2️⃣  启动Claude: claude"
