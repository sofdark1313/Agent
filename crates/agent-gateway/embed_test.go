package gateway

import (
	"io/fs"
	"os"
	"sort"
	"testing"
)

func TestWebUIAssetsIncludeEntireDistTree(t *testing.T) {
	diskFiles := regularFileSizes(t, os.DirFS("."), "web/dist")
	embeddedFiles := regularFileSizes(t, WebUIAssets, "web/dist")

	var missing []string
	for file, size := range diskFiles {
		embeddedSize, ok := embeddedFiles[file]
		if !ok {
			missing = append(missing, file)
			continue
		}
		if embeddedSize != size {
			t.Fatalf("embedded WebUI asset %q size = %d, want %d", file, embeddedSize, size)
		}
	}

	if len(missing) > 0 {
		sort.Strings(missing)
		t.Fatalf("embedded WebUI assets are missing files from web/dist: %v", missing)
	}
}

func regularFileSizes(t *testing.T, fileSystem fs.FS, root string) map[string]int64 {
	t.Helper()

	files := make(map[string]int64)
	err := fs.WalkDir(fileSystem, root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode().IsRegular() {
			files[path] = info.Size()
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk %q: %v", root, err)
	}
	return files
}
