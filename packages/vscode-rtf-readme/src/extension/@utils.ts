import * as vscode from 'vscode';

export async function getMarkdownTitle(
  readmeFilePath: string,
): Promise<string | undefined> {
  let readmeFileContent = (
    await vscode.workspace.fs.readFile(vscode.Uri.file(readmeFilePath))
  ).toString();

  let matchResult = readmeFileContent.match(
    /((?<atxlayer>#+)\s*(?<atxname>.+))|((?<setexname>[\w|\d|\s|-]+)\n(?<setexLayer>[-|=]{2,}))/,
  );

  return matchResult?.[3] || matchResult?.[5];
}

export async function getDataFromInputBox(
  inputBoxInfo: {
    title: string;
    prompt?: string;
  },
  validate: (data: string) => string | true,
  defaultValue?: string,
  // @ts-ignore
): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: inputBoxInfo.title,
    prompt: inputBoxInfo.prompt,
    ignoreFocusOut: true,
    value: defaultValue,
    validateInput: value => {
      let validateResult = validate(value);

      if (validateResult === true) {
        return '';
      }

      return validateResult;
    },
  });
}
