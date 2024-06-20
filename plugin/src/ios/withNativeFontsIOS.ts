import { ConfigPlugin, ExportedConfigWithProps, XcodeProject, withXcodeProject, IOSConfig } from "@expo/config-plugins"
import { ExpoNativeFontOptions, ExpoNativeFontsOptions } from ".."
import * as path from "path"
import fsExtra from "fs-extra"

const getIOSFonts = (options: ExpoNativeFontsOptions) => {
    return options.fonts.filter(f => f.platform !== 'android')
}

type FontsGrouped = {
    [targetId: string]: ExpoNativeFontOptions[]
}

const groupByTarget = (fonts: ExpoNativeFontOptions[]) => {
    let groupedFonts: FontsGrouped = {}

    for (const font of fonts) {
        const {
            targets,
        } = font

        if (!targets) {
            throw new Error(`Targets is required for iOS font ${font.name || font.filePath}`)
        }

        for (const target of targets) {
            groupedFonts[target] = [
                ...(groupedFonts[target] || []),
                font,
            ]
        }
    }

    return groupedFonts
}

const updateXcodeProject = (config: ExportedConfigWithProps<XcodeProject>, options: ExpoNativeFontsOptions, grouped: FontsGrouped) => {
    const targets = Object.keys(grouped)

    copyFontFiles(config, options)

    for (const target of targets) {
        const fonts = grouped[target]
        addFontToXcodeProj(config, options, target, fonts)
    }

    return config
}

const getFontName = ({ name, filePath }: ExpoNativeFontOptions) => {
    if (name) {
        return name
    }

    const ext = path.extname(filePath)
    return path.basename(filePath).replace(ext, "")
}

const getPBXTargetByName = (project: XcodeProject, name: string) => {
    var targetSection = project.pbxNativeTargetSection()

    for (const uuid in targetSection) {
        const target = targetSection[uuid]
        
        if (target.name === name) {
            return {
                uuid,
                target,
            }
        }    
    }

    return { target: null, uuid: null }
}

const addFontToXcodeProj = (config: ExportedConfigWithProps<XcodeProject>, options: ExpoNativeFontsOptions, targetName: string, fonts: ExpoNativeFontOptions[]) => {
    console.log(`Adding fonts to target ${targetName}`)
    const project = config.modResults;

    const fontFiles = fonts.map(font => font.filePath)
    console.log('Font files:')
    console.log(fontFiles)

    console.log(`Searching for target ${targetName}`)
    const { target, uuid: targetUuid } = getPBXTargetByName(project, targetName)

    if (!target || !targetUuid) {
        throw new Error(`expo-native-fonts:: cannot find target ${targetName}. Has the target been set up correctly?`)
    }

    console.log(`Target UUID: ${targetUuid}`)

    for (const filePath of fontFiles) {
        console.log(`Adding resource file ${filePath}`)
        config.modResults = IOSConfig.XcodeUtils.addResourceFileToGroup({
            filepath: path.join('Fonts', filePath),
            groupName: 'Resources',
            project,
            isBuildFile: true,
            verbose: true,
            targetUuid,
        });
    }
    console.log('Resource files copied successfully.')
    return config
}

const updateInfoPlist = (config: ExportedConfigWithProps<XcodeProject>, options: ExpoNativeFontsOptions, grouped: FontsGrouped) => {
    const {
        projectRoot,
    } = config.modRequest

    console.log('Updating Info.plist files')

    for (const targetName in grouped) {
        const targetFonts = grouped[targetName]
        const plistFilePath = path.join(projectRoot, 'ios', targetName, 'Info.plist')
        console.log(`plistFilePath: ${plistFilePath}`)

        if (!fsExtra.existsSync(plistFilePath)) {
            const directory = path.dirname(plistFilePath)

            if (!fsExtra.existsSync(directory)) {
                fsExtra.mkdirSync(directory, { recursive: true })
            }

            fsExtra.writeFileSync(plistFilePath, `<?xml version="1.0" encoding="UTF-8"?>
            <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
            <plist version="1.0">
            <dict>
            </dict>
            </plist>
            `)
            //throw new Error(`There is no Info.plist file at ${plistFilePath}. You must ensure your target has a Info.plist file to add fonts.`)
        }
        
        const contents = fsExtra.readFileSync(plistFilePath, 'utf-8')
        const dictTag = '<dict>'
        const dictIndex = contents.indexOf(dictTag)
        let insertIndex = dictIndex + dictTag.length

        if (dictIndex === -1) {
            console.log(contents)
            console.log(`dictIndex: ${dictIndex}`)
            const plistEndIndex = contents.indexOf('</plist>')

            if (plistEndIndex === -1) {
                throw new Error(`Your Info.plist file at ${plistFilePath} does not have a <dict> or </plist> tag. Please add this to your file.`)
            }
            else {
                insertIndex = plistEndIndex;
            }
        }       
        
        const insertionKeys = targetFonts.reduce((contents, { filePath }) => {
            const name = path.basename(filePath)

            return `${contents}
            <string>${name}</string>`
        }, '')

        const insertionContents = `<key>UIAppFonts</key>
        <array>
        ${insertionKeys}
        </array>`

        const newPlistContents = contents.slice(0, insertIndex) + insertionContents + contents.slice(insertIndex)
        fsExtra.writeFileSync(plistFilePath, newPlistContents)
    }

    return config
}

const copyFontFiles = (config: ExportedConfigWithProps<XcodeProject>, { srcFolder }: ExpoNativeFontsOptions) => {
    const {
        projectRoot,
    } = config.modRequest

    console.log(`Copying files`)
    const sourceDir = path.join(projectRoot, srcFolder)
    const targetDir = path.join(projectRoot, 'ios', 'Fonts')

    console.log(`SourceDir: ${sourceDir}`)
    console.log(`TargetDir: ${targetDir}`)

    if (!fsExtra.lstatSync(sourceDir).isDirectory()) {
        throw new Error(`The provided sourceDir is not a directory. This value must be the directory of your font files.`)
    }

    if (!fsExtra.existsSync(targetDir)) {
        fsExtra.mkdirSync(targetDir, { recursive: true });
    }

    fsExtra.copySync(sourceDir, targetDir)
    console.log(`Font files copied to ios/Fonts`)
}

/**
 * This is the plugin entry method
 * @param config 
 * @param options 
 * @returns 
 */
export const withExpoNativeFontsIOS: ConfigPlugin<ExpoNativeFontsOptions> = (config, options) => {
    return withXcodeProject(config, (config) => {
         injectExpoNativeFontsIOS(config, options)
         return config;
    })
}

/**
 * This is the entry other modules
 * @param config 
 * @param options 
 * @returns 
 */
export const injectExpoNativeFontsIOS = (config: ExportedConfigWithProps<XcodeProject>, options: ExpoNativeFontsOptions): XcodeProject => {
    const iosFonts = getIOSFonts(options)
    const grouped = groupByTarget(iosFonts)

    updateInfoPlist(config, options, grouped)
    updateXcodeProject(config, options, grouped)
}