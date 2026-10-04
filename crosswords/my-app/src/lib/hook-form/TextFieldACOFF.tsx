import { Box } from "@mui/material";
import TextField, { TextFieldProps } from "@mui/material/TextField";
import { useFormContext, Controller } from "react-hook-form"
import { fieldHolder } from "./general";


interface iTextFieldProps {
    label: string;
    id?: string;
    name: string;
    type?: "text" | "password"
    helperText: string;
    autoComplete?:boolean;
}


const TextFieldACOFF = ({ label, name, type = "text", helperText, id, }: iTextFieldProps) => {

    const { control, formState: { errors }, } = useFormContext();

    

    return <Controller
        name={name}
        control={control}
        render={(thing) => {


            const hText: string = (errors[name]?.message ? errors[name].message?.toString() : helperText);
            const error: boolean = (errors[name]?.message ? true : false)
            const textFieldProps: TextFieldProps = {
                value: thing.field.value ? thing.field.value : '',
                onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                    thing.field.onChange(event.target.value);
                },
                type,
                error,
                label,
                helperText: hText
            }

            return <Box sx={{ ...fieldHolder }}>
                <TextField id={id} name={name} fullWidth {...textFieldProps}  slotProps={{
                    input: {
        
                    },
                }} />

            </Box>

        }}


    />
}


export default TextFieldACOFF;