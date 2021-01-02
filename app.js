const path = require('path');
const fs = require('fs-extra');
const puppeteer = require('puppeteer');
const _ = require('lodash');
const async = require('async');
const argv = require('minimist')(process.argv.slice(2));
const url = require('url');

const playlistId = url.parse(argv.url, true).query.id;

(async () => {
  const browser = await puppeteer.launch({ headless: false, defaultViewport: { width: 1200, height: 600 } });
  const page = await browser.newPage();
  await page.goto(`https://music.163.com/#/playlist?id=${playlistId}`, { timeout: 1 * 60 * 1000, waitUntil: 'networkidle0' });
  await page.waitForSelector('.m-tophead .link');
  await page.waitForTimeout(1 * 1000);
  await page.click('.m-tophead .link');
  await page.waitForFunction(() => {
    const aEle = document.body.querySelector('.m-tophead .head a');
    if (aEle && aEle.getAttribute('href').includes('/user/home')) {
      return true;
    }
    return false;
  }, {
    timeout: 5 * 60 * 1000
  });
  await page.reload();
  await page.waitForFunction(() => {
    const iframe = document.body.querySelector('iframe');
    return !!(iframe && iframe.contentDocument.body.querySelector('.n-songtb tbody'));
  }, {
    timeout: 1 * 60 * 1000
  });
  const onlinePlaylist = await page.evaluate(() => {
    const aTrs = document.body.querySelector('iframe').contentDocument.body.querySelectorAll('.n-songtb tbody tr');
    const list = [...aTrs].map(tr => {
      const aTds = tr.querySelectorAll('td');
      const title = aTds[1].querySelector('.txt b').getAttribute('title');
      const name = title.split('-')[0].trim().split('(')[0].trim();
      const author = aTds[3].querySelector('.text').getAttribute('title').trim();
      return {
        search: `${name} - ${author}`,
        name,
        duration: aTds[2].innerText,
        author,
        album: aTds[4].querySelector('.text a').getAttribute('title')
      }
    });
    return list;
  });

  const playlistFilepath = path.resolve(`./${playlistId}.json`);
  let playlistLocal = [];
  if (fs.existsSync(playlistFilepath)) {
    playlistLocal = fs.readJSONSync(playlistFilepath);
  }
  const playlist = _.unionBy(playlistLocal.concat(onlinePlaylist), item => item.search);
  fs.writeJSONSync(playlistFilepath, playlist, { spaces: 2 });

  await page.goto('https://music.apple.com', { timeout: 2 * 60 * 1000 });
  // await page.waitForSelector('.web-navigation__auth a');
  // await page.waitForTimeout(3 * 1000);
  // await page.click('.web-navigation__auth a');

  await page.waitForFunction(() => {
    const aLinks = document.querySelectorAll('.web-navigation__scrollable a');
    return [...aLinks]
      .filter(item => item.getAttribute('href').includes('/library/recently-added'))
      .length > 0;
  }, { timeout: 1 * 60 * 1000 });

  const run = async (song) => {
    await page.goto(`https://music.apple.com/cn/search?term=${song.search}`);
    await page.waitForFunction(() => {
      return !!document.querySelector('.search__search-hits') || (!!document.querySelector('.search__no-results'));
    }, {
      timeout: 1 * 60 * 1000
    });
    await page.evaluate((song) => {
      const aSongLi = document.querySelectorAll('.dt-shelf--search-song .shelf-grid__body .shelf-grid__list > li');
      const list = [...aSongLi]
        .map(item => {
          const aDescLi = item.querySelectorAll('.list-lockup-description li');
          return {
            addButton: item.querySelector('.web-add-to-library.not-in-library'),
            name: aDescLi[0] ? aDescLi[0].innerText : null,
            author: aDescLi[1] ? aDescLi[1].innerText : null
          }
        })
        .filter(item => item.name);
      const isEqual = (a, b) => String(a).toLocaleLowerCase().includes(String(b).toLocaleLowerCase());
      const item = list.find(item => isEqual(item.name, song.name) && isEqual(item.author, song.author))||
        list.find(item => isEqual(item.name, song.name)) ||
        list[0];
      if (item && item.addButton) {
        item.addButton.click();
      }
    }, song);
  }

  await async.eachOfSeries(playlist, (song, index, done) => {
    if (song.processed) {
      done(null, song);
      return;
    }
    console.log(`${song.name}`);
    run(song)
      .then(() => {
        console.log(`${index + 1} / ${playlist.length}`)
        playlist[index].processed = true;
        fs.writeJSONSync(playlistFilepath, playlist, { spaces: 2 });
      })
      .finally(() => done(null, song));
  });

  await browser.close();
})();
