"""Prepares the image assets the Unity project commits: skin textures and ambientCG colour maps at 1024 (JPG)."""
import sys
from PIL import Image
C = sys.argv[1]
out = sys.argv[2]
Image.open(f'{C}/ubc/Universal Base Characters[Standard]/Base Characters/Textures/T_Superhero_Male_Ligh.png').convert('RGB').resize((1024, 1024), Image.LANCZOS).save(f'{out}/CricketerSkin_Light.jpg', quality=82)
Image.open(f'{C}/CricketerSkin_Dark.jpg').save(f'{out}/CricketerSkin_Dark.jpg', quality=90)
for src, dst in [('Grass005/Grass005_1K-JPG_Color.jpg', 'Grass005_Color.jpg'), ('Ground109/Ground109_1K-JPG_Color.jpg', 'Ground109_Color.jpg'), ('Concrete034/Concrete034_1K-JPG_Color.jpg', 'Concrete034_Color.jpg'), ('Grass005/Grass005_1K-JPG_NormalGL.jpg', 'Grass005_Normal.jpg')]:
    Image.open(f'{C}/acg/{src}').convert('RGB').save(f'{out}/{dst}', quality=85)
print('ok')
