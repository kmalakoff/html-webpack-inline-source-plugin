'use strict';
const assert = require('assert');
const escapeRegex = require('escape-string-regexp');
const path = require('path');
const slash = require('slash');
const sourceMapUrl = require('source-map-url');

let htmlWebpackPlugin = null;
try {
  htmlWebpackPlugin = require('html-webpack-plugin');
} catch (_err) {}

function HtmlWebpackInlineSourcePlugin (htmlWebpackPluginOption) {
  this.htmlWebpackPlugin = htmlWebpackPluginOption || htmlWebpackPlugin;
  assert(!!this.htmlWebpackPlugin, 'html-webpack-inline-source-plugin requires html-webpack-plugin as a peer dependency. Please install html-webpack-plugin');
}

HtmlWebpackInlineSourcePlugin.prototype.apply = function (compiler) {
  const self = this;

  // Hook into the html-webpack-plugin processing
  compiler.hooks.compilation.tap('html-webpack-inline-source-plugin', function (compilation) {
    const hooks = self.htmlWebpackPlugin.getHooks(compilation);

    hooks.alterAssetTags.tap('html-webpack-inline-source-plugin', function (htmlPluginData) {
      if (!htmlPluginData.plugin.options.inlineSource) return htmlPluginData;
      const regexStr = htmlPluginData.plugin.options.inlineSource;
      return self.processTags(compilation, regexStr, htmlPluginData);
    });
  });
};

HtmlWebpackInlineSourcePlugin.prototype.processTags = function (compilation, regexStr, pluginData) {
  const self = this;
  const regex = new RegExp(regexStr);
  const filename = pluginData.plugin.options.filename;

  const meta = pluginData.assetTags.meta.map(function (tag) { return self.processTag(compilation, regex, tag, filename); });
  const scripts = pluginData.assetTags.scripts.map(function (tag) { return self.processTag(compilation, regex, tag, filename); });
  const styles = pluginData.assetTags.styles.map(function (tag) { return self.processTag(compilation, regex, tag, filename); });

  const result = { ...pluginData };
  result.assetTags = { meta, scripts, styles };
  return result;
};

HtmlWebpackInlineSourcePlugin.prototype.resolveSourceMaps = function (compilation, assetInfo) {
  const out = compilation.outputOptions;

  // Extract original sourcemap URL from source string
  let source = assetInfo.asset.source();
  if (typeof source !== 'string') source = source.toString();

  // Return unmodified source if map is unspecified, URL-encoded, or already relative to site root
  const mapUrlOriginal = sourceMapUrl.getFrom(source);
  if (!mapUrlOriginal || mapUrlOriginal.indexOf('data:') === 0 || mapUrlOriginal.indexOf('/') === 0) {
    return source;
  }

  // Figure out sourcemap file path *relative to the asset file path*
  const rootPath = slash(out.path);
  const assetPath = path.posix.join(rootPath, assetInfo.assetName);
  const assetDir = path.posix.dirname(assetPath);
  const mapPath = path.posix.join(assetDir, mapUrlOriginal);
  const mapPathRelative = path.posix.relative(rootPath, mapPath);

  // Prepend Webpack public URL path to source map relative path
  // Calling `slash` converts Windows backslashes to forward slashes
  const publicPath = out.publicPath === 'auto' ? '' : slash(out.publicPath) || '';
  const mapUrlCorrected = publicPath ? path.posix.join(publicPath, mapPathRelative) : mapPathRelative;

  // Regex: exact original sourcemap URL, possibly '*/' (for CSS), then EOF, ignoring whitespace
  // Replace sourcemap URL and (if necessary) preserve closing '*/' and whitespace
  const regex = new RegExp(escapeRegex(mapUrlOriginal) + '(\\s*(?:\\*/)?\\s*$)');
  return source.replace(regex, function (match, group) {
    return mapUrlCorrected + group;
  });
};

HtmlWebpackInlineSourcePlugin.prototype.processTag = function (compilation, regex, tag, filename) {
  const out = compilation.outputOptions;
  let assetUrl;

  // inline js
  if (tag.tagName === 'script' && regex.test(tag.attributes.src)) assetUrl = tag.attributes.src;
  // inline css
  else if (tag.tagName === 'link' && regex.test(tag.attributes.href)) assetUrl = tag.attributes.href;
  // not inline
  else return tag;

  // if filename is in subfolder, assetUrl should be prepended folder path
  const basename = path.basename(filename);
  if (basename !== filename) assetUrl = path.posix.join(slash(basename), assetUrl);

  // Strip public URL prefix from asset URL to get Webpack asset name
  const publicPath = out.publicPath === 'auto' ? '' : slash(out.publicPath) || '';
  const assetName = path.posix.relative(publicPath, assetUrl);
  const assetInfo = getAssetByName(compilation.assets, assetName, publicPath);
  if (!assetInfo) return tag; // cannot inline

  const updatedSource = this.resolveSourceMaps(compilation, assetInfo);
  return {
    tagName: tag.tagName === 'script' ? 'script' : 'style',
    closeTag: true,
    attributes: { type: tag.tagName === 'script' ? 'text/javascript' : 'text/css' },
    innerHTML: tag.tagName === 'script' ? updatedSource.replace(/(<)(\/script>)/g, '\\x3C$2') : updatedSource,
    meta: { plugin: 'html-webpack-inline-source-plugin' }
  };
};

function getAssetByName (assets, assetName, publicPath) {
  const asset = assets[assetName];
  if (asset) return { asset, assetName };

  for (const key in assets) {
    if (Object.prototype.hasOwnProperty.call(assets, key)) {
      const processedKey = path.posix.relative(publicPath, key);
      if (processedKey === assetName) return { asset, assetName: key };
    }
  }
}

module.exports = HtmlWebpackInlineSourcePlugin;
