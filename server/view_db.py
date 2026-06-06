import sqlite3
import os

DATABASE_PATH = os.path.join(os.path.dirname(__file__), "safetalk.db")

def print_table(title, rows, colnames):
    print(f"\n=== {title.upper()} TABLE ===")
    if not rows:
        print("[Empty]")
        return
        
    # Find max length for spacing
    col_widths = [len(name) for name in colnames]
    for row in rows:
        for idx, val in enumerate(row):
            col_widths[idx] = max(col_widths[idx], len(str(val)))
            
    # Print Headers
    header_str = " | ".join(f"{name:<{col_widths[idx]}}" for idx, name in enumerate(colnames))
    print(header_str)
    print("-" * len(header_str))
    
    # Print Rows
    for row in rows:
        print(" | ".join(f"{str(val):<{col_widths[idx]}}" for idx, val in enumerate(row)))

def main():
    if not os.path.exists(DATABASE_PATH):
        print(f"Database file not found at {DATABASE_PATH}. Have you started the server yet?")
        return
        
    import database
    conn = sqlite3.connect(DATABASE_PATH)
    c = conn.cursor()
    
    # 1. Users
    c.execute("SELECT * FROM users")
    print_table("users", c.fetchall(), ["username", "offense_count", "blocked_until"])
    
    # 2. Blocks
    c.execute("SELECT * FROM blocks")
    print_table("blocks", c.fetchall(), ["blocker", "blocked"])
    
    # 3. Offenses
    c.execute("SELECT id, username, text, reason, content_type, created_at FROM offenses")
    offenses_rows = c.fetchall()
    decrypted_offenses = []
    for row in offenses_rows:
        decrypted_row = list(row)
        decrypted_row[2] = database.decrypt_text(row[2])  # Decrypt the text column
        decrypted_offenses.append(decrypted_row)
    print_table("offenses", decrypted_offenses, ["id", "username", "text", "reason", "content_type", "created_at"])
    
    # 4. Whitelist
    c.execute("SELECT * FROM whitelist")
    whitelist_rows = c.fetchall()
    decrypted_whitelist = []
    for row in whitelist_rows:
        decrypted_row = list(row)
        decrypted_row[2] = database.decrypt_text(row[2])  # Decrypt the whitelist content
        decrypted_whitelist.append(decrypted_row)
    print_table("whitelist", decrypted_whitelist, ["channel", "content_type", "content"])
    
    conn.close()

if __name__ == "__main__":
    main()
