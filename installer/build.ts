// Builds the downloads served by docs/index.html: the macOS/Linux installer zipped (a zip keeps its execute
// bit, which a plain browser download loses) and the Windows installer as is.
// Usage: npm run installers
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const here = resolve(import.meta.dirname);
const docs = resolve(here, "..", "docs");

/** A zip with one file, marked as a Unix executable. */
function zipExecutable(name: string, data: Buffer): Buffer {
	const body = deflateRawSync(data);
	const crc = crc32(data);
	const file = Buffer.from(name);
	// 1980-01-01 00:00, so the zip is the same on every build.
	const [time, date] = [0, (0 << 9) | (1 << 5) | 1];
	const local = Buffer.alloc(30);
	local.writeUInt32LE(0x04034b50, 0);
	local.writeUInt16LE(20, 4);
	local.writeUInt16LE(0x0800, 6); // UTF-8 names
	local.writeUInt16LE(8, 8); // deflate
	local.writeUInt16LE(time, 10);
	local.writeUInt16LE(date, 12);
	local.writeUInt32LE(crc, 14);
	local.writeUInt32LE(body.length, 18);
	local.writeUInt32LE(data.length, 22);
	local.writeUInt16LE(file.length, 26);
	const central = Buffer.alloc(46);
	central.writeUInt32LE(0x02014b50, 0);
	central.writeUInt16LE((3 << 8) | 20, 4); // made by Unix, so the external attributes carry the mode
	central.writeUInt16LE(20, 6);
	central.writeUInt16LE(0x0800, 8);
	central.writeUInt16LE(8, 10);
	central.writeUInt16LE(time, 12);
	central.writeUInt16LE(date, 14);
	central.writeUInt32LE(crc, 16);
	central.writeUInt32LE(body.length, 20);
	central.writeUInt32LE(data.length, 24);
	central.writeUInt16LE(file.length, 28);
	central.writeUInt32LE(((0o100755 << 16) >>> 0) >>> 0, 38);
	const offset = local.length + file.length + body.length;
	const size = central.length + file.length;
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(1, 8);
	end.writeUInt16LE(1, 10);
	end.writeUInt32LE(size, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([local, file, body, central, file, end]);
}

const command = "rydspine-setup.command";
writeFileSync(join(docs, "rydspine-setup-mac.zip"), zipExecutable(command, readFileSync(join(here, command))));
copyFileSync(join(here, "rydspine-setup.bat"), join(docs, "rydspine-setup-windows.bat"));
console.log(`written to ${docs}`);
