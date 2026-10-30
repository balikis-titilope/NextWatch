// Central module for every image/icon asset import (AGENTS.md §10) -- never
// a scattered require('../../../assets/foo.png') inline in a screen.
export const logo = require("./logo.png") as number;
// Web landing page images (spec 0011), cropped from the design screenshot
// (context/landing-design.png). Low resolution: replace with full size
// originals when available.
export const landingHero = require("./landing-hero.jpg") as number;
export const landingBokeh = require("./landing-bokeh.jpg") as number;
// Web login/signup split screen side image (spec 0012), a free Pexels stock
// photo (Pexels license, no attribution required).
export const authCinema = require("./auth-cinema.jpg") as number;
// Light mode hero (spec 0011): a bright theater photo that sits well on the
// cream light palette. Free Pexels stock photo (Pexels license).
export const landingHeroLight = require("./landing-hero-light.jpg") as number;
