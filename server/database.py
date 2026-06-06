import sqlite3
import os
import time
from cryptography.fernet import Fernet

DATABASE_PATH = os.path.join(os.path.dirname(__file__), "safetalk.db")
KEY_PATH = os.path.join(os.path.dirname(__file__), "secret.key")

# Auto-generate or load the encryption key file
if not os.path.exists(KEY_PATH):
    key = Fernet.generate_key()
    with open(KEY_PATH, "wb") as key_file:
        key_file.write(key)
else:
    with open(KEY_PATH, "rb") as key_file:
        key = key_file.read()

cipher_suite = Fernet(key)

def encrypt_text(text: str) -> str:
    if not text:
        return ""
    try:
        return cipher_suite.encrypt(text.encode()).decode()
    except Exception:
        return text

def decrypt_text(encrypted_text: str) -> str:
    if not encrypted_text:
        return ""
    try:
        return cipher_suite.decrypt(encrypted_text.encode()).decode()
    except Exception:
        return encrypted_text

def get_db_connection():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 1. Users Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            offense_count INTEGER DEFAULT 0,
            blocked_until INTEGER
        )
    """)
    
    # 2. Blocks Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS blocks (
            blocker TEXT,
            blocked TEXT,
            PRIMARY KEY (blocker, blocked)
        )
    """)
    
    # 3. Offenses Log Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS offenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            text TEXT,
            reason TEXT,
            content_type TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # 4. Channel Whitelist Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS whitelist (
            channel TEXT,
            content_type TEXT,
            content TEXT,
            PRIMARY KEY (channel, content_type, content)
        )
    """)
    
    conn.commit()
    conn.close()

# Helper Functions
def get_user_state(username: str, other_username: str = None):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Ensure user exists
    cursor.execute("INSERT OR IGNORE INTO users (username, offense_count, blocked_until) VALUES (?, 0, NULL)", (username,))
    conn.commit()
    
    cursor.execute("SELECT offense_count, blocked_until FROM users WHERE username = ?", (username,))
    user_row = cursor.fetchone()
    
    offense_count = user_row["offense_count"]
    blocked_until = user_row["blocked_until"]
    
    # Self-healing: if suspension time has elapsed, reset offense count and clear blocked_until in database
    if blocked_until and int(time.time() * 1000) >= blocked_until:
        cursor.execute("UPDATE users SET offense_count = 0, blocked_until = NULL WHERE username = ?", (username,))
        conn.commit()
        offense_count = 0
        blocked_until = None
        
    blocked_by_other = False
    if other_username:
        # Check if the OTHER user blocked THIS user
        cursor.execute("SELECT 1 FROM blocks WHERE blocker = ? AND blocked = ?", (other_username, username))
        blocked_by_other = cursor.fetchone() is not None
        
    conn.close()
    
    return {
        "offenseCount": offense_count,
        "blockedUntil": blocked_until,
        "blockedByOther": blocked_by_other
    }

def record_offense(username: str, text: str, reason: str, content_type: str, suspension_duration_ms: int = 120000):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Encrypt text before writing to DB for privacy preservation
    encrypted_text = encrypt_text(text)
    
    # Log offense details
    cursor.execute(
        "INSERT INTO offenses (username, text, reason, content_type) VALUES (?, ?, ?, ?)",
        (username, encrypted_text, reason, content_type)
    )
    
    # Increment user offense count
    cursor.execute("INSERT OR IGNORE INTO users (username, offense_count, blocked_until) VALUES (?, 0, NULL)", (username,))
    cursor.execute("UPDATE users SET offense_count = offense_count + 1 WHERE username = ?", (username,))
    
    # Fetch updated count
    cursor.execute("SELECT offense_count FROM users WHERE username = ?", (username,))
    offense_count = cursor.fetchone()["offense_count"]
    
    blocked_until = None
    if offense_count >= 3:
        # Set lockout block
        blocked_until = int(time.time() * 1000) + suspension_duration_ms
        cursor.execute("UPDATE users SET blocked_until = ? WHERE username = ?", (blocked_until, username))
        
    conn.commit()
    conn.close()
    
    return {
        "offenseCount": offense_count,
        "blockedUntil": blocked_until
    }

def clear_user_suspension(username: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET offense_count = 0, blocked_until = NULL WHERE username = ?", (username,))
    conn.commit()
    conn.close()

def add_user_block(blocker: str, blocked: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT OR IGNORE INTO blocks (blocker, blocked) VALUES (?, ?)", (blocker, blocked))
    conn.commit()
    conn.close()

def remove_user_block(blocker: str, blocked: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM blocks WHERE blocker = ? AND blocked = ?", (blocker, blocked))
    conn.commit()
    conn.close()

def add_to_whitelist(channel: str, content_type: str, content: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Encrypt whitelist content for user privacy
    encrypted_content = encrypt_text(content)
    
    cursor.execute(
        "INSERT OR IGNORE INTO whitelist (channel, content_type, content) VALUES (?, ?, ?)",
        (channel, content_type, encrypted_content)
    )
    conn.commit()
    conn.close()

def get_channel_whitelist(channel: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT content_type, content FROM whitelist WHERE channel = ?", (channel,))
    rows = cursor.fetchall()
    conn.close()
    
    whitelist_data = {
        "texts": [],
        "images": [],
        "audios": [],
        "videos": []
    }
    
    for row in rows:
        c_type = row["content_type"]
        # Decrypt whitelist values for the client on-the-fly
        decrypted_content = decrypt_text(row["content"])
        
        # Map DB categories to schema
        if c_type == "text":
            whitelist_data["texts"].append(decrypted_content)
        elif c_type == "image":
            whitelist_data["images"].append(decrypted_content)
        elif c_type == "audio":
            whitelist_data["audios"].append(decrypted_content)
        elif c_type == "video":
            whitelist_data["videos"].append(decrypted_content)
            
    return whitelist_data
