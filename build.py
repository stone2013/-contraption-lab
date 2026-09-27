"""Bundle the zero-dependency game into one offline HTML file (Python 3.9+)."""
from pathlib import Path
import argparse

ROOT = Path(__file__).resolve().parent

def build(destination: Path) -> Path:
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    css = (ROOT / 'styles.css').read_text(encoding='utf-8')
    html = html.replace('<link rel="stylesheet" href="styles.css">', f'<style>\n{css}\n</style>')
    for name in ('physics.js', 'levels.js', 'app.js'):
        js = (ROOT / name).read_text(encoding='utf-8').replace('</script', '<\\/script')
        html = html.replace(f'<script src="{name}"></script>', f'<script>\n{js}\n</script>')
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(html, encoding='utf-8')
    return destination

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', nargs='?', type=Path, default=ROOT / 'contraption-lab-mobile.html')
    args = parser.parse_args()
    print(build(args.output))
