from app.db import init_db
from app.repository import make_album_id, upsert_album
from app.schemas import ScrapedAlbum, ScrapedSong

init_db()

albums = [
    ScrapedAlbum(
        album_url="https://demo.local/albums/midnight-drive",
        album_id=make_album_id("https://demo.local/albums/midnight-drive", "Midnight Drive"),
        album_name="Midnight Drive",
        year=2026,
        music_director="Neon Pulse",
        singers_summary="Neon Pulse",
        image_url="https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=900&q=80",
        language="Tamil",
        songs=[
            ScrapedSong(track_name="Nightfall", track_number=1, singers="Neon Pulse", image_url=None, url_128kbps="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", url_320kbps="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"),
            ScrapedSong(track_name="Glowline", track_number=2, singers="Neon Pulse", image_url=None, url_128kbps="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3", url_320kbps="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3"),
            ScrapedSong(track_name="Speed Lights", track_number=3, singers="Neon Pulse", image_url=None, url_128kbps="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3", url_320kbps="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3"),
        ],
    )
]

for album in albums:
    upsert_album(album)

print("Demo seed complete.")
