# Obsidian Publish Action

:warning: This action is not maintained anymore.

Publishes files to [Obsidian](https://obsidian.md).

## Inputs

### `site`

**Required.** The Obsidian site ID.

### `token`

**Required.** The Obsidian API token.

## Example usage

``` yaml
- uses: tfausak/obsidian-publish-action@v1
  with:
    site: ${{ secrets.OBSIDIAN_SITE }}
    token: ${{ secrets.OBSIDIAN_TOKEN }}
```
